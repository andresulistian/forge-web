import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

// Exercise the production facade against controlled provider protocols, without
// using credentials, calling a live AI provider, or modifying a user's workspace.
const adapter = `
class Driver {
  constructor(kind, emit) { this.kind=kind; this.emit=emit; this.active=null; this.approvals=new Map(); this.threads=new Map(); this.calls=[]; }
  async models() { return [{model:"selected-model",isDefault:true,inputModalities:["text","image"]}]; }
  find() { return {type:this.providerType||"openrouter",defaultModel:"selected-model"}; }
  async turn(project,mode,prompt,...args) {
    const model=this.kind==="codex"?args[0]:args[1];
    const media=this.kind==="codex"?args[1]:args[4];
    this.calls.push({project,mode,prompt,model,media}); this.active={projectId:project.id};
    const event=(method,params={})=>this.emit("codex",{projectId:project.id,provider:this.kind,method,params});
    this.lastEvent=event; event("turn/started");
    const perform=async()=>{
      if(this.hang) { await new Promise(resolve=>{this.release=resolve}); return "stopped"; }
      const value=this.answer?await this.answer({project,mode,prompt}):prompt.startsWith("Independently inspect")?JSON.stringify({verdict:"PASS",criteria:[{id:"C1",status:"pass",evidence:"fixture test result"}]}):"worker report";
      event("usage",{prompt_tokens:5,completion_tokens:5});
      event("item/completed",{item:{type:"agentMessage",text:value}});
      this.active=null; event("turn/completed",{turn:{status:"completed"}}); return value;
    };
    if(this.kind==="codex") { setTimeout(()=>void perform().catch(error=>{this.active=null;event("turn/completed",{turn:{error:{message:error.message}}});}),1); return {turn:{id:"native-turn"}}; }
    return perform();
  }
  decide(id,accept) { const a=this.approvals.get(id); if(!a)throw Error("missing approval"); this.approvals.delete(id); a.resolve(accept); }
  stop() { this.active=null; this.release?.(); }
  close() { this.stop(); }
  fail() { this.active=null; }
}
export class Agents {
  constructor(emit) { this.codex=new Driver("codex",emit); this.apiProviders=new Driver("api",emit); this.gemini={active:null}; this.ollama={active:null}; }
  get active() { return this.codex.active||this.apiProviders.active; }
  get approvals() { return new Map([...this.codex.approvals,...this.apiProviders.approvals]); }
  async turn(...args) { this.singleArgs=args; return "single-result"; }
  async catalog() { return {models:[]}; }
  decide(id,accept) { return (String(id).startsWith("api:")?this.apiProviders:this.codex).decide(id,accept); }
  async stop() { this.codex.stop(); this.apiProviders.stop(); }
  async close() { return this.stop(); }
}`;
async function fixture(t, approve = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-facade-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const server = path.join(root, "server"); await fs.mkdir(server);
  for (const file of ["agents.mjs", "workflow-plan.mjs", "workflow-bindings.mjs", "workflow-checks.mjs", "specialist-coordinator.mjs"])
    await fs.copyFile(new URL(`../server/${file}`, import.meta.url), path.join(server, file));
  await fs.writeFile(path.join(server, "provider-agents.mjs"), adapter);
  const project = { id: "actual-project", path: path.join(root, "project") };
  await fs.mkdir(project.path);
  await fs.writeFile(path.join(project.path, "package.json"), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
  const { Agents } = await import(pathToFileURL(path.join(server, "agents.mjs")));
  const bindings = await import(pathToFileURL(path.join(server, "workflow-bindings.mjs")));
  const { planSpecialists } = await import(pathToFileURL(path.join(server, "workflow-plan.mjs")));
  const events = []; let agents;
  agents = new Agents((type, payload) => {
    events.push({ type, payload });
    if (type === "approval" && approve !== null) queueMicrotask(() => agents.decide(payload.id, approve));
  }, root, root);
  t.after(() => agents.close());
  return { root, Agents, agents, bindings, planSpecialists, project, events };
}

test("default constructor and single-agent Ask preserve the previous dispatch contract", async (t) => {
  const { Agents, agents, project } = await fixture(t);
  assert.doesNotThrow(() => new Agents(() => {}));
  const media = [{images:[{data:"logo"}]}];
  assert.equal(await agents.turn(project,"ask","question","codex","selected-model",media),"single-result");
  assert.equal(agents.singleArgs[5],media);
  assert.equal(agents.singleArgs[8],false);
});
for (const provider of ["codex", "api:router"]) test(`${provider}: isolated role sessions, same selected model, one parent completion and actual QA`, async (t) => {
  const { agents, project, events, bindings, planSpecialists, root } = await fixture(t);
  const request = "Upload logo to preview";
  const plan = planSpecialists(request);
  let recorded;
  bindings.bindWorkflow(root,project.id,{runId:"run-1",plan,record:async result=>{recorded=result;}});
  const media = [{images:[{data:"reference-logo",mimeType:"image/png"}]}];
  const text = await agents.turn(project,"build",request+"\nDesign: preserve purple",provider,"selected-model",media,request,"",true);
  assert.equal(recorded.ok,true);
  assert.match(text,/Pemeriksaan workflow lulus/);
  const calls = (provider==="codex"?agents.codex:agents.apiProviders).calls;
  assert.equal(calls.length,plan.roles.length);
  assert.equal(new Set(calls.map(call=>call.project.id)).size,plan.roles.length);
  assert.ok(calls.every(call=>call.model==="selected-model"&&call.project.path===project.path));
  assert.ok(calls.every(call=>call.media===media));
  assert.equal(events.filter(event=>event.payload.method==="turn/completed").length,1);
  assert.equal(events.filter(event=>event.payload.method==="item/completed"&&event.payload.params?.item?.type==="agentMessage").length,1);
  assert.ok(events.every(event=>!event.payload.projectId||event.payload.projectId===project.id));
  assert.equal(events.filter(event=>event.type==="approval").length,1);
  assert.equal(agents.active,null);
});
test("workflow consumes the exact bound Economy plan rather than recomputing Balanced", async (t) => {
  const { agents, bindings, planSpecialists, root, project } = await fixture(t);
  const request="Upload logo to preview";
  const plan=planSpecialists(request,"economy");
  bindings.bindWorkflow(root,project.id,{runId:"economy-run",plan,record:async()=>{}});
  await agents.turn(project,"build",request,"api:router","selected-model",[],request,"",true);
  assert.equal(agents.apiProviders.calls.length,1);
  assert.match(agents.apiProviders.calls[0].prompt,/smallest coordinated UI\/API change/);
});
test("denied QA approval marks parent failure and preserves review blocking", async (t) => {
  const { agents, project, events } = await fixture(t,false);
  await agents.turn(project,"build","Fix button","api:router","selected-model",[],"Fix button","",true);
  const end=events.find(event=>event.payload.method==="turn/completed");
  assert.equal(end.payload.params.turn.status,"failed");
  assert.equal(agents.apiProviders.calls.length,1);
});
test("stop closes pending QA approvals without leaving a busy UI", async (t) => {
  const { agents, project, events } = await fixture(t,null);
  const pending=agents.turn(project,"build","Fix button","api:router","selected-model",[],"Fix button","",true);
  for(let i=0;i<100&&!agents.approvals.size;i++) await new Promise(resolve=>setTimeout(resolve,2));
  assert.ok(agents.active);
  assert.equal([...agents.approvals.values()][0].projectId,project.id);
  await agents.stop();
  await assert.rejects(pending,/dihentikan/);
  assert.equal(agents.active,null);
  assert.equal(agents.approvals.size,0);
  assert.equal(events.filter(event=>event.payload.method==="turn/completed").length,1);
});
test("stop during native Codex work rejects the stage and suppresses late lifecycle events", async (t) => {
  const { agents, project, events } = await fixture(t);
  agents.codex.hang=true;
  const pending=agents.turn(project,"build","Fix button","codex","selected-model",[],"Fix button","",true);
  for(let i=0;i<100&&!agents.codex.calls.length;i++) await new Promise(resolve=>setTimeout(resolve,2));
  await agents.stop();
  await assert.rejects(pending,/dihentikan/);
  agents.codex.lastEvent("turn/completed",{turn:{status:"completed"}});
  assert.equal(events.filter(event=>event.payload.method==="turn/completed").length,1);
  assert.equal(agents.active,null);
});
test("unsupported model/audio and removed ViKey cannot silently dispatch", async (t) => {
  const { agents, project } = await fixture(t);
  await assert.rejects(agents.turn(project,"build","Fix button","codex","missing",[],"Fix button","",true),/tidak tersedia/);
  await assert.rejects(agents.turn(project,"build","Fix button","codex","selected-model",[{audio:{data:"audio"}}],"Fix button","",true),/audio/);
  agents.apiProviders.providerType="vikey";
  await assert.rejects(agents.turn(project,"build","Fix button","api:removed","selected-model",[],"Fix button","",true),/dinonaktifkan/);
  assert.equal(agents.apiProviders.calls.length,0);
});

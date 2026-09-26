let context: AudioContext | null = null;

function audioContext() {
  context ??= new AudioContext();
  return context;
}

export async function unlockNotificationAudio() {
  const audio = audioContext();
  if (audio.state === "suspended") await audio.resume();
}

export function playApprovalSound() {
  try {
    const audio = audioContext();
    if (audio.state !== "running") return;
    const now = audio.currentTime;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    gain.connect(audio.destination);

    for (const [frequency, delay] of [
      [659.25, 0],
      [880, 0.14],
    ] as const) {
      const oscillator = audio.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now + delay);
      oscillator.connect(gain);
      oscillator.start(now + delay);
      oscillator.stop(now + delay + 0.24);
    }
  } catch {
    // Audio is an enhancement. Approval controls must keep working if blocked.
  }
}

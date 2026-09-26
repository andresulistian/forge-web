/** PCM16 mono WAV keeps the complete audio timeline without requiring ffmpeg. */
export function encodeWav(
  samples: Float32Array,
  sampleRate = 16000,
): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(
      44 + i * 2,
      Math.round(sample < 0 ? sample * 32768 : sample * 32767),
      true,
    );
  }
  return bytes;
}
export async function extractAudio(file: File) {
  const decoder = new OfflineAudioContext(1, 1, 16000);
  let decoded: AudioBuffer;
  try {
    decoded = await decoder.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw Error(
      "Audio tidak dapat dibaca. Gunakan MP4 dengan audio AAC, atau file MP3/M4A/WAV yang didukung perangkat. Audio tidak akan dilewati diam-diam.",
    );
  }
  if (!decoded.length || decoded.duration <= 0)
    throw Error("Tidak ada audio yang dapat dianalisis.");
  if (decoded.duration > 300)
    throw Error(
      "Audio/video maksimal 5 menit agar seluruh audio bisa dikirim. Potong file menjadi beberapa bagian.",
    );
  const mono = new Float32Array(decoded.length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const samples = decoded.getChannelData(channel);
    for (let i = 0; i < mono.length; i++)
      mono[i] += samples[i] / decoded.numberOfChannels;
  }
  const bytes = encodeWav(mono, decoded.sampleRate);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return {
    data: btoa(binary),
    mimeType: "audio/wav",
    duration: decoded.duration,
  };
}

declare module "opus-recorder" {
  type RecorderOptions = {
    encoderPath?: string; mimeType?: string; numberOfChannels?: number; encoderSampleRate?: number;
    encoderApplication?: number; encoderBitRate?: number; streamPages?: boolean; maxFramesPerPage?: number; monitorGain?: number; recordingGain?: number;
  };
  export default class Recorder {
    constructor(options?: RecorderOptions);
    static isRecordingSupported(): boolean;
    ondataavailable: (data: Uint8Array) => void;
    onstart: () => void; onstop: () => void; onpause: () => void; onresume: () => void;
    start(): Promise<void>; stop(): Promise<void>; pause(): void; resume(): void; close(): void;
  }
}

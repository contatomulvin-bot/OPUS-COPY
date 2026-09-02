import { TranscriptionProvider, TranscriptionResult } from '../transcription-provider';
import { WhisperXTranscriptionProvider } from './whisperx-transcription-provider';
import { defaultGeminiTranscriptionProvider } from './gemini-transcription-provider';

export class HybridTranscriptionProvider implements TranscriptionProvider {
  name = 'WhisperX local + Gemini fallback';
  private whisperx = new WhisperXTranscriptionProvider();

  async isAvailable(): Promise<boolean> {
    return (await this.whisperx.isAvailable()) || (await defaultGeminiTranscriptionProvider.isAvailable());
  }

  async transcribe(audioPath: string, options?: { language?: string }): Promise<TranscriptionResult> {
    let whisperError: unknown = null;
    if (await this.whisperx.isAvailable()) {
      try {
        console.log('[transcription] Using WhisperX local provider.');
        return await this.whisperx.transcribe(audioPath, options);
      } catch (error) {
        whisperError = error;
        console.warn('[transcription] WhisperX failed; falling back to Gemini:', error);
      }
    }

    if (await defaultGeminiTranscriptionProvider.isAvailable()) {
      console.log('[transcription] Using Gemini fallback provider.');
      return defaultGeminiTranscriptionProvider.transcribe(audioPath, options);
    }

    const detail = whisperError instanceof Error ? ` WhisperX: ${whisperError.message}` : '';
    throw new Error(`TRANSCRIPTION_UNAVAILABLE: WhisperX não está disponível e GEMINI_API_KEY não está configurada.${detail}`);
  }
}

export const defaultTranscriptionProvider = new HybridTranscriptionProvider();

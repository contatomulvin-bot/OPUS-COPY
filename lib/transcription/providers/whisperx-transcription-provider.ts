import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { TranscriptionProvider, TranscriptionResult, TranscriptSegmentDTO, TranscriptWordDTO, TranscriptionResultSchema } from '../transcription-provider';

interface WhisperXResponse {
  language: string;
  text: string;
  segments: Array<{
    start: number;
    end: number;
    text: string;
    words?: Array<{ word?: string; start?: number; end?: number }>;
  }>;
}

function pythonCandidates(): string[] {
  return process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
}

function runWhisperX(python: string, audioPath: string, language?: string): Promise<WhisperXResponse> {
  const scriptPath = path.resolve(process.cwd(), 'scripts', 'transcribe_whisperx.py');
  return new Promise((resolve, reject) => {
    const args = [scriptPath, '--audio', audioPath];
    if (language) args.push('--language', language);
    const child = spawn(python, args, { cwd: process.cwd(), windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `WhisperX encerrou com código ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`WhisperX retornou uma resposta inválida. Saída: ${stdout.slice(-1000)}`));
      }
    });
  });
}

export class WhisperXTranscriptionProvider implements TranscriptionProvider {
  name = 'WhisperX local';
  private selectedPython: string | null = null;

  async isAvailable(): Promise<boolean> {
    if (!fs.existsSync(path.resolve(process.cwd(), 'scripts', 'transcribe_whisperx.py'))) return false;
    for (const candidate of pythonCandidates()) {
      try {
        const result = await new Promise<number>(resolve => {
          const child = spawn(candidate, ['-c', 'import whisperx'], { windowsHide: true });
          child.on('error', () => resolve(1));
          child.on('close', code => resolve(code ?? 1));
        });
        if (result === 0) {
          this.selectedPython = candidate;
          return true;
        }
      } catch {
        // Try the next Python executable.
      }
    }
    return false;
  }

  async transcribe(audioPath: string, options?: { language?: string }): Promise<TranscriptionResult> {
    if (!fs.existsSync(audioPath)) throw new Error(`AUDIO_NOT_FOUND: Arquivo não encontrado: ${audioPath}`);
    const python = this.selectedPython || (await this.findPython());
    if (!python) throw new Error('WHISPERX_UNAVAILABLE: Python/WhisperX não está instalado.');

    const raw = await runWhisperX(python, audioPath, options?.language);
    if (!raw.text?.trim() || !Array.isArray(raw.segments)) {
      throw new Error('INVALID_TRANSCRIPTION: WhisperX não retornou uma transcrição válida.');
    }

    const segments: TranscriptSegmentDTO[] = raw.segments
      .map((segment, index) => {
        const words: TranscriptWordDTO[] = (segment.words || [])
          .filter(word => typeof word.start === 'number' && typeof word.end === 'number' && word.end > word.start && String(word.word || '').trim())
          .map(word => ({ word: String(word.word).trim(), startTime: word.start as number, endTime: word.end as number }));
        return {
          id: `seg-${index + 1}`,
          startTime: Number(segment.start),
          endTime: Number(segment.end),
          text: String(segment.text || '').trim(),
          words,
        };
      })
      .filter(segment => Number.isFinite(segment.startTime) && Number.isFinite(segment.endTime) && segment.endTime > segment.startTime && segment.text.length > 0);

    const result: TranscriptionResult = {
      language: raw.language || options?.language || 'pt',
      text: raw.text.trim(),
      segments,
    };
    const validation = TranscriptionResultSchema.safeParse(result);
    if (!validation.success) throw new Error(`INVALID_TRANSCRIPTION: Resultado WhisperX inválido: ${validation.error.message}`);
    return validation.data;
  }

  private async findPython(): Promise<string | null> {
    for (const candidate of pythonCandidates()) {
      try {
        const code = await new Promise<number>(resolve => {
          const child = spawn(candidate, ['-c', 'import whisperx'], { windowsHide: true });
          child.on('error', () => resolve(1));
          child.on('close', value => resolve(value ?? 1));
        });
        if (code === 0) {
          this.selectedPython = candidate;
          return candidate;
        }
      } catch {
        // Continue.
      }
    }
    return null;
  }
}

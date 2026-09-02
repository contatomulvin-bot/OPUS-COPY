import fs from 'fs';
import path from 'path';
import { Caption, SubtitleStyle } from '../types';

export interface SubtitleGeneratorOptions {
  safeMarginBottom?: number; // default: 280 (safe area in 1080x1920)
  playResX?: number;          // default: 1080
  playResY?: number;          // default: 1920
}

export class SubtitleGenerator {
  /**
   * Formats seconds into SRT timestamp (00:01:23,456)
   */
  formatTimeSRT(seconds: number): string {
    const s = Math.max(0, seconds);
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const secs = Math.floor(s % 60);
    const millis = Math.floor((s % 1) * 1000);

    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${secs.toString().padStart(2, '0')},${millis
      .toString()
      .padStart(3, '0')}`;
  }

  /**
   * Formats seconds into ASS timestamp (0:01:23.45)
   */
  formatTimeASS(seconds: number): string {
    const s = Math.max(0, seconds);
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const secs = Math.floor(s % 60);
    const centis = Math.floor((s % 1) * 100);

    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}.${centis.toString().padStart(2, '0')}`;
  }

  /**
   * Escapes special characters for ASS/SSA scripts
   */
  escapeASSText(text: string): string {
    return text
      .replace(/\\/g, '') // remove backslashes
      .replace(/{/g, '(')  // replace curlies
      .replace(/}/g, ')')
      .trim();
  }

  /**
   * Breaks text into max-width lines for mobile 9:16 readability
   */
  wrapTextForMobile(text: string, maxCharsPerLine = 24): string {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= 1) return text;

    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if ((currentLine + ' ' + word).trim().length > maxCharsPerLine) {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = (currentLine + ' ' + word).trim();
      }
    }

    if (currentLine) lines.push(currentLine);
    return lines.join('\\N');
  }

  /**
   * Generates standard SRT file content
   */
  generateSRT(captions: Caption[]): string {
    const blocks: string[] = [];

    captions.forEach((cap, index) => {
      const startStr = this.formatTimeSRT(cap.startTime);
      const endStr = this.formatTimeSRT(cap.endTime);
      const text = cap.text.trim();

      if (text) {
        blocks.push(`${index + 1}\n${startStr} --> ${endStr}\n${text}\n`);
      }
    });

    return blocks.join('\n');
  }

  /**
   * Generates styled ASS (Advanced SubStation Alpha) file content
   */
  generateASS(
    captions: Caption[],
    style: SubtitleStyle = 'BOLD',
    options: SubtitleGeneratorOptions = {}
  ): string {
    const playResX = options.playResX ?? 1080;
    const playResY = options.playResY ?? 1920;
    const marginV = options.safeMarginBottom ?? (style === 'BOLD' ? 300 : style === 'DYNAMIC' ? 310 : 280);

    // Color definitions in &HAABBGGRR format
    // Alignment: 2 = Bottom Center
    let styleDef = '';

    if (style === 'BOLD') {
      // BOLD: Yellow primary (&H0000E5FF in BGR = RGB(255, 229, 0)), thick black border (4.5), 60pt font
      styleDef = `Style: Default,Arial Black,60,&H0000E5FF,&H00000000,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,5.0,2.5,2,40,40,${marginV},1`;
    } else if (style === 'DYNAMIC') {
      // DYNAMIC: Cyan/White primary (&H00FFFF00 in BGR = RGB(0, 255, 255)), bold shadow, 64pt font
      styleDef = `Style: Default,Trebuchet MS,64,&H00FFF500,&H00000000,&H00000000,&HA0000000,-1,0,0,0,100,100,0,0,1,5.5,3.0,2,40,40,${marginV},1`;
    } else {
      // CLEAN: Pure white (&H00FFFFFF), subtle black outline (2.5), 52pt font
      styleDef = `Style: Default,Helvetica,52,&H00FFFFFF,&H00000000,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3.0,1.5,2,40,40,${marginV},1`;
    }

    const lines: string[] = [
      '[Script Info]',
      'Title: AI Clipper Shorts Subtitles',
      'ScriptType: v4.00+',
      'WrapStyle: 0',
      `PlayResX: ${playResX}`,
      `PlayResY: ${playResY}`,
      'ScaledBorderAndShadow: yes',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      styleDef,
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ];

    for (const cap of captions) {
      if (cap.endTime <= cap.startTime) continue;

      const startASS = this.formatTimeASS(cap.startTime);
      const endASS = this.formatTimeASS(cap.endTime);

      let text = this.escapeASSText(cap.text);
      if (style === 'BOLD' || style === 'DYNAMIC') {
        text = text.toUpperCase();
      }

      const wrappedText = this.wrapTextForMobile(text, style === 'BOLD' ? 22 : 26);
      lines.push(`Dialogue: 0,${startASS},${endASS},Default,,0,0,0,,${wrappedText}`);
    }

    return lines.join('\n');
  }

  /**
   * Generates and writes SRT and ASS files to disk
   */
  async saveSubtitleFiles(
    clipId: string,
    captions: Caption[],
    style: SubtitleStyle,
    baseDirectory: string
  ): Promise<{ srtPath: string; assPath: string }> {
    if (!fs.existsSync(baseDirectory)) {
      fs.mkdirSync(baseDirectory, { recursive: true });
    }

    const srtPath = path.join(baseDirectory, `${clipId}.srt`);
    const assPath = path.join(baseDirectory, `${clipId}.ass`);

    const srtContent = this.generateSRT(captions);
    const assContent = this.generateASS(captions, style);

    await Promise.all([
      fs.promises.writeFile(srtPath, srtContent, 'utf-8'),
      fs.promises.writeFile(assPath, assContent, 'utf-8'),
    ]);

    return { srtPath, assPath };
  }
}

export const defaultSubtitleGenerator = new SubtitleGenerator();

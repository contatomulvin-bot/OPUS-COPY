import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { TranscriptionProvider, TranscriptionResult, TranscriptSegmentDTO, TranscriptWordDTO, TranscriptionResultSchema } from '../transcription-provider';

interface WhisperXResponse { language:string; text:string; segments:Array<{start:number;end:number;text:string;words?:Array<{word?:string;start?:number;end?:number}>}>; }
function pythonCandidates():string[]{const local=process.platform==='win32'?path.resolve(process.cwd(),'.venv-whisperx','Scripts','python.exe'):path.resolve(process.cwd(),'.venv-whisperx','bin','python'); return fs.existsSync(local)?[local,...(process.platform==='win32'?['python','py']:['python3','python'])]:(process.platform==='win32'?['python','py']:['python3','python']);}
function runWhisperX(python:string,audioPath:string,language?:string):Promise<WhisperXResponse>{const scriptPath=path.resolve(process.cwd(),'scripts','transcribe_whisperx.py');return new Promise((resolve,reject)=>{const args=[scriptPath,'--audio',audioPath];if(language)args.push('--language',language);const child=spawn(python,args,{cwd:process.cwd(),windowsHide:true});let stdout='';let stderr='';child.stdout.on('data',c=>{stdout+=c.toString();});child.stderr.on('data',c=>{stderr+=c.toString();});child.on('error',reject);child.on('close',code=>{if(code!==0){reject(new Error(stderr.trim()||`WhisperX encerrou com código ${code}`));return;}try{resolve(JSON.parse(stdout));}catch{reject(new Error(`WhisperX retornou resposta inválida. Saída: ${stdout.slice(-1000)}`));}});});}

export class WhisperXTranscriptionProvider implements TranscriptionProvider {
  name='WhisperX local'; private selectedPython:string|null=null;
  async isAvailable(){if(!fs.existsSync(path.resolve(process.cwd(),'scripts','transcribe_whisperx.py')))return false;return Boolean(await this.findPython());}
  async transcribe(audioPath:string,options?:{language?:string}):Promise<TranscriptionResult>{
    if(!fs.existsSync(audioPath))throw new Error(`AUDIO_NOT_FOUND: Arquivo não encontrado: ${audioPath}`);
    const python=this.selectedPython||(await this.findPython());if(!python)throw new Error('WHISPERX_UNAVAILABLE: Python/WhisperX não está instalado.');
    const raw=await runWhisperX(python,audioPath,options?.language);if(!raw.text?.trim()||!Array.isArray(raw.segments))throw new Error('INVALID_TRANSCRIPTION: WhisperX não retornou uma transcrição válida.');
    const segments:TranscriptSegmentDTO[]=raw.segments.map((s,i)=>({id:`seg-${i+1}`,startTime:Number(s.start),endTime:Number(s.end),text:String(s.text||'').trim(),words:(s.words||[]).filter(w=>typeof w.start==='number'&&typeof w.end==='number'&&w.end>w.start&&String(w.word||'').trim()).map(w=>({word:String(w.word).trim(),startTime:w.start as number,endTime:w.end as number}))})).filter(s=>Number.isFinite(s.startTime)&&Number.isFinite(s.endTime)&&s.endTime>s.startTime&&s.text.length>0);
    const result:TranscriptionResult={language:raw.language||options?.language||'pt',text:raw.text.trim(),segments};const validation=TranscriptionResultSchema.safeParse(result);if(!validation.success)throw new Error(`INVALID_TRANSCRIPTION: Resultado WhisperX inválido: ${validation.error.message}`);return validation.data;
  }
  private async findPython():Promise<string|null>{for(const candidate of pythonCandidates()){try{const code=await new Promise<number>(resolve=>{const child=spawn(candidate,['-c','import whisperx'],{windowsHide:true});child.on('error',()=>resolve(1));child.on('close',v=>resolve(v??1));});if(code===0){this.selectedPython=candidate;return candidate;}}catch{/* next */}}return null;}
}

import { prisma } from '../db/prisma';
import { StorageProvider } from '../storage/storage-provider';
import { defaultStorage } from '../storage/providers/local-storage-provider';
import { TranscriptionProvider, TranscriptionResult, TranscriptionResultSchema } from '../transcription/transcription-provider';
import { defaultTranscriptionProvider } from '../transcription/providers/hybrid-transcription-provider';
import { serializePrisma } from '../utils/serializer';
import fs from 'fs';

export interface TranscribeOptions { language?: string; forceRetranscribe?: boolean; }

export class TranscriptService {
  private storage: StorageProvider; private provider: TranscriptionProvider;
  constructor(storage: StorageProvider = defaultStorage, provider: TranscriptionProvider = defaultTranscriptionProvider) { this.storage=storage; this.provider=provider; }

  static formatTranscriptForAI(segments: { startTime:number; endTime:number; text:string }[]):string {
    const formatTime=(seconds:number)=>{const mins=Math.floor(seconds/60);const secs=(seconds%60).toFixed(2);return `${String(mins).padStart(2,'0')}:${Number(secs)<10?`0${secs}`:secs}`;};
    return segments.map(seg=>`[${formatTime(seg.startTime)} - ${formatTime(seg.endTime)}]\n${seg.text.trim()}`).join('\n\n');
  }

  async transcribeVideo(videoId:string, options:TranscribeOptions={}) {
    const video=await prisma.video.findUnique({where:{id:videoId},include:{transcript:{include:{segments:{include:{words:true},orderBy:{startTime:'asc'}}}}}});
    if(!video)throw new Error('VIDEO_NOT_FOUND: Vídeo não encontrado.');
    if(video.transcript&&video.transcript.segments.length>0&&!options.forceRetranscribe&&video.status==='TRANSCRIBED')return serializePrisma(video.transcript);
    if(!video.audioPath)throw new Error('AUDIO_NOT_FOUND: O arquivo de áudio deste vídeo ainda não foi extraído.');
    const audioAbsolutePath=this.storage.getAbsolutePath(video.audioPath);
    if(!fs.existsSync(audioAbsolutePath))throw new Error(`AUDIO_NOT_FOUND: Arquivo de áudio não encontrado no caminho: ${audioAbsolutePath}`);
    if(!(await this.provider.isAvailable()))throw new Error('TRANSCRIPTION_UNAVAILABLE: Instale o WhisperX local ou configure GEMINI_API_KEY para usar o fallback.');

    await prisma.video.update({where:{id:videoId},data:{status:'TRANSCRIBING',progress:85,currentStep:'Transcrevendo áudio localmente com WhisperX...',errorMessage:null}});
    try {
      const transcriptionResult=await this.provider.transcribe(audioAbsolutePath,{language:options.language||'pt'});
      const validation=TranscriptionResultSchema.safeParse(transcriptionResult);
      if(!validation.success)throw new Error(`INVALID_TRANSCRIPTION: Dados de transcrição inválidos: ${validation.error.message}`);
      const {language,text,segments}=validation.data;
      const savedTranscript=await prisma.$transaction(async tx=>{
        await tx.transcript.deleteMany({where:{videoId}});
        const transcript=await tx.transcript.create({data:{videoId,language,text}});
        for(const seg of segments){
          const createdSegment=await tx.transcriptSegment.create({data:{transcriptId:transcript.id,startTime:seg.startTime,endTime:seg.endTime,text:seg.text}});
          if(seg.words?.length)await tx.transcriptWord.createMany({data:seg.words.map(w=>({segmentId:createdSegment.id,word:w.word,startTime:w.startTime,endTime:w.endTime}))});
        }
        await tx.video.update({where:{id:videoId},data:{status:'TRANSCRIBED',progress:100,currentStep:'Transcrição e timestamps concluídos com sucesso.',errorMessage:null}});
        return tx.transcript.findUnique({where:{id:transcript.id},include:{segments:{include:{words:true},orderBy:{startTime:'asc'}}}});
      });
      return serializePrisma(savedTranscript);
    } catch(err:any) {
      console.error(`Erro ao transcrever vídeo ${videoId}:`,err);
      const errorMessage=err.message||'Falha na transcrição do áudio.';
      await prisma.video.update({where:{id:videoId},data:{status:'FAILED',errorMessage,currentStep:'Falha durante a transcrição.'}});
      throw err;
    }
  }

  async getTranscript(videoId:string) {
    const transcript=await prisma.transcript.findUnique({where:{videoId},include:{segments:{include:{words:true},orderBy:{startTime:'asc'}}}});
    return transcript?serializePrisma(transcript):null;
  }
}
export const defaultTranscriptService=new TranscriptService();

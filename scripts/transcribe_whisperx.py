import argparse
import json
import os
import sys


def safe_cpu_threads():
    default = max(1, min(os.cpu_count() or 4, 8))
    try:
        value = int(os.environ.get('WHISPER_CPU_THREADS', str(default)))
    except ValueError:
        return default
    return value if value > 0 else default


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--audio', required=True)
    parser.add_argument('--language', default=None)
    args = parser.parse_args()

    if not os.path.isfile(args.audio) or os.path.getsize(args.audio) == 0:
        print('AUDIO_NOT_FOUND: arquivo de audio ausente ou vazio', file=sys.stderr)
        return 3

    model_name = os.environ.get('WHISPERX_MODEL', 'small')
    device = os.environ.get('WHISPERX_DEVICE', 'cpu')
    compute_type = os.environ.get('WHISPERX_COMPUTE_TYPE', 'int8' if device == 'cpu' else 'float16')
    batch_size = int(os.environ.get('WHISPERX_BATCH_SIZE', '8'))

    try:
        import whisperx
        model = whisperx.load_model(model_name, device=device, compute_type=compute_type, language=args.language)
        result = model.transcribe(args.audio, batch_size=batch_size, language=args.language)
        language = result.get('language') or args.language or 'pt'

        # Word-level alignment is attempted when a compatible alignment model exists.
        try:
            align_model, metadata = whisperx.load_align_model(language_code=language, device=device)
            result = whisperx.align(result['segments'], align_model, metadata, args.audio, device, return_char_alignments=False)
        except Exception as exc:  # noqa: BLE001 - alignment is optional and falls back below
            print(f'WHISPERX_ALIGNMENT_WARNING: {exc}', file=sys.stderr)

        output = {
            'language': language,
            'text': ' '.join(str(s.get('text', '')).strip() for s in result.get('segments', [])).strip(),
            'segments': result.get('segments', []),
        }
        if output['text']:
            print(json.dumps(output, ensure_ascii=False))
            return 0
        raise RuntimeError('WhisperX retornou transcrição vazia.')
    except Exception as exc:  # noqa: BLE001 - any WhisperX failure activates faster-whisper
        print(f'WHISPERX_WARNING: {exc}', file=sys.stderr)

    # Last local fallback: faster-whisper does not need the alignment model.
    # It still returns word timestamps when word_timestamps=True.
    try:
        from faster_whisper import WhisperModel
        model = WhisperModel(
            model_name,
            device=device,
            compute_type=compute_type,
            cpu_threads=safe_cpu_threads(),
            num_workers=1,
        )
        segments_iter, info = model.transcribe(args.audio, language=args.language, word_timestamps=True, vad_filter=True)
        segments = []
        texts = []
        for segment in segments_iter:
            words = []
            for word in segment.words or []:
                words.append({'word': word.word, 'start': float(word.start), 'end': float(word.end)})
            segments.append({'start': float(segment.start), 'end': float(segment.end), 'text': segment.text, 'words': words})
            texts.append(segment.text.strip())
        text = ' '.join(t for t in texts if t).strip()
        if not text:
            raise RuntimeError('faster-whisper retornou transcrição vazia.')
        print(json.dumps({'language': getattr(info, 'language', None) or args.language or 'pt', 'text': text, 'segments': segments}, ensure_ascii=False))
        return 0
    except Exception as exc:  # noqa: BLE001 - command-line boundary must return a clean error code
        print(f'FASTER_WHISPER_ERROR: {exc}', file=sys.stderr)
        return 4


if __name__ == '__main__':
    raise SystemExit(main())

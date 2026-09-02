import argparse
import json
import os
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--audio', required=True)
    parser.add_argument('--language', default=None)
    args = parser.parse_args()

    try:
        import whisperx
    except Exception as exc:
        print(f'WHISPERX_IMPORT_ERROR: {exc}', file=sys.stderr)
        return 2

    if not os.path.isfile(args.audio) or os.path.getsize(args.audio) == 0:
        print('AUDIO_NOT_FOUND: arquivo de audio ausente ou vazio', file=sys.stderr)
        return 3

    # WhisperX official GPU path is CUDA/NVIDIA. This project also runs on AMD Windows,
    # so CPU is the reliable default and avoids pretending ROCm/CUDA is available.
    device = 'cpu'
    compute_type = 'int8'
    batch_size = 8
    model_name = os.environ.get('WHISPERX_MODEL', 'small')

    try:
        model = whisperx.load_model(model_name, device=device, compute_type=compute_type, language=args.language)
        result = model.transcribe(args.audio, batch_size=batch_size, language=args.language)

        language = result.get('language') or args.language or 'pt'
        align_language = language
        try:
            metadata = whisperx.load_align_model(language_code=align_language, device=device)
            align_model, metadata = metadata
            result = whisperx.align(result['segments'], align_model, metadata, args.audio, device, return_char_alignments=False)
        except Exception as exc:
            # Alignment is valuable but must not make transcription unusable.
            print(f'WHISPERX_ALIGNMENT_WARNING: {exc}', file=sys.stderr)

        output = {
            'language': language,
            'text': ' '.join(str(s.get('text', '')).strip() for s in result.get('segments', [])).strip(),
            'segments': result.get('segments', []),
        }
        print(json.dumps(output, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(f'WHISPERX_TRANSCRIPTION_ERROR: {exc}', file=sys.stderr)
        return 4


if __name__ == '__main__':
    raise SystemExit(main())

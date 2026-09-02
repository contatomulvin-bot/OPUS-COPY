import { VideoMetadata, ReframeMode, CropCalculationResult } from '../types';

export interface AutoReframeProvider {
  calculateCrop(
    metadata: VideoMetadata,
    options?: {
      targetWidth?: number;
      targetHeight?: number;
      reframeMode?: ReframeMode;
    }
  ): CropCalculationResult;
}

export class SmartAutoReframeProvider implements AutoReframeProvider {
  calculateCrop(
    metadata: VideoMetadata,
    options: {
      targetWidth?: number;
      targetHeight?: number;
      reframeMode?: ReframeMode;
    } = {}
  ): CropCalculationResult {
    const { width: srcWidth, height: srcHeight } = metadata;
    const targetWidth = options.targetWidth || 1080;
    const targetHeight = options.targetHeight || 1920;
    const mode = options.reframeMode || 'AUTO';

    const srcAspect = srcWidth / (srcHeight || 1);
    const targetAspect = targetWidth / (targetHeight || 1); // 9/16 = 0.5625

    // Check if source is already near 9:16 vertical (e.g., 0.50 - 0.65)
    const isVerticalSource = Math.abs(srcAspect - targetAspect) < 0.08 || srcAspect < 0.65;

    if (isVerticalSource) {
      return {
        cropX: 0,
        cropY: 0,
        cropWidth: srcWidth,
        cropHeight: srcHeight,
        scaleWidth: targetWidth,
        scaleHeight: targetHeight,
        isVerticalSource: true,
        aspectRatio: srcAspect,
        filterGraph: `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
      };
    }

    if (mode === 'FIT_BLUR') {
      return {
        cropX: 0,
        cropY: 0,
        cropWidth: srcWidth,
        cropHeight: srcHeight,
        scaleWidth: targetWidth,
        scaleHeight: targetHeight,
        isVerticalSource: false,
        aspectRatio: srcAspect,
        filterGraph: `split=2[bg][fg];[bg]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight},boxblur=25:5[bgblur];[fg]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease[fgscaled];[bgblur][fgscaled]overlay=(W-w)/2:(H-h)/2,setsar=1`,
      };
    }

    // Horizontal (16:9, 4:3, 1:1) -> 9:16 Vertical Crop
    // Crop width must be srcHeight * (9/16)
    let cropWidth = Math.round(srcHeight * targetAspect);
    let cropHeight = srcHeight;

    // Ensure cropWidth does not exceed srcWidth
    if (cropWidth > srcWidth) {
      cropWidth = srcWidth;
      cropHeight = Math.round(srcWidth / targetAspect);
    }

    // Ensure even numbers for H.264 compatibility
    cropWidth = cropWidth % 2 === 0 ? cropWidth : cropWidth - 1;
    cropHeight = cropHeight % 2 === 0 ? cropHeight : cropHeight - 1;

    let cropX = Math.round((srcWidth - cropWidth) / 2);
    let cropY = Math.round((srcHeight - cropHeight) / 2);

    // Keep within valid source bounds
    cropX = Math.max(0, Math.min(srcWidth - cropWidth, cropX));
    cropY = Math.max(0, Math.min(srcHeight - cropHeight, cropY));

    // Filter string: crop then scale
    const filterGraph = `crop=${cropWidth}:${cropHeight}:${cropX}:${cropY},scale=${targetWidth}:${targetHeight},setsar=1`;

    return {
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      scaleWidth: targetWidth,
      scaleHeight: targetHeight,
      isVerticalSource: false,
      aspectRatio: srcAspect,
      filterGraph,
    };
  }
}

export const defaultAutoReframeProvider = new SmartAutoReframeProvider();

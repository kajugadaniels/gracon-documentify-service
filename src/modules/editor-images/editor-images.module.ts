import { Module } from '@nestjs/common';
import { EditorImagesController } from './editor-images.controller';
import { EditorImagesService } from './editor-images.service';

@Module({
  controllers: [EditorImagesController],
  providers: [EditorImagesService],
})
export class EditorImagesModule {}

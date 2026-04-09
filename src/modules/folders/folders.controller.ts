import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
} from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { FoldersService } from './folders.service';
import { CreateFolderDto } from './dto/create-folder.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../auth/interfaces/jwt-payload.interface';

class RenameFolderDto {
  @IsString()
  @MaxLength(255)
  name: string;
}

@ApiTags('Folders')
@ApiBearerAuth()
@Controller('folders')
export class FoldersController {
  constructor(private readonly service: FoldersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a folder (optionally nested inside another folder)',
  })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateFolderDto) {
    return this.service.create(user.userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List all folders owned by the current user (with subfolders)',
  })
  findAll(@CurrentUser() user: RequestUser) {
    return this.service.findAll(user.userId);
  }

  @Patch(':folderId/rename')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'folderId', type: String })
  @ApiOperation({ summary: 'Rename a folder' })
  rename(
    @CurrentUser() user: RequestUser,
    @Param('folderId') folderId: string,
    @Body() dto: RenameFolderDto,
  ) {
    return this.service.rename(user.userId, folderId, dto.name);
  }

  @Delete(':folderId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'folderId', type: String })
  @ApiOperation({
    summary: 'Delete a folder — documents inside are moved to root (no folder)',
  })
  delete(
    @CurrentUser() user: RequestUser,
    @Param('folderId') folderId: string,
  ) {
    return this.service.delete(user.userId, folderId);
  }
}

import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreatePartyDto } from './create-party.dto';

export class UpdatePartyDto extends PartialType(CreatePartyDto) {
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

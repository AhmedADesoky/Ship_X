import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateRepaymentDto {
  // Duplicates the :advanceId route param in the body — needed because
  // ApprovalInterceptor only ever captures a single `:id`-shaped entityId
  // (request.params.id) when queuing this route for approval; the pending
  // action's dispatch handler needs the advance id from the stored
  // payload since this route has two dynamic path segments.
  @IsString()
  advanceId: string;

  @IsString()
  safeId: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsString()
  note?: string;
}

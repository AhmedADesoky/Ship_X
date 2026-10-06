import { IsNotEmpty, IsString } from 'class-validator';

export class AssignSheetCollectionDto {
  @IsString()
  @IsNotEmpty()
  courierId: string;

  // Duplicates the :collectionId route param in the body — ApprovalInterceptor
  // only ever captures a single `:id`-shaped param into the stored
  // PendingAction's entityId (see approval.interceptor.ts), and this
  // route's dynamic segment is named :collectionId, not :id. Mirrors the
  // same workaround CreateRepaymentDto already uses for :advanceId.
  @IsString()
  @IsNotEmpty()
  collectionId: string;
}

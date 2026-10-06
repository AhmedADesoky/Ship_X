import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateTransactionDto } from './create-transaction.dto';

// kind is immutable on edit, matching the old app's EditTx (no kind field —
// edit_transaction() reuses old['kind']).
export class UpdateTransactionDto extends PartialType(OmitType(CreateTransactionDto, ['kind'] as const)) {}

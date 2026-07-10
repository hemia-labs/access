import { IsOptional, IsString, MaxLength } from 'class-validator';

// ponytail: campos manuales en vez de PartialType para no sumar @nestjs/mapped-types
export class UpdateWidgetDto {
  @IsOptional()
  @IsString({ message: 'El nombre debe ser una cadena de texto' })
  @MaxLength(100, { message: 'El nombre no puede exceder 100 caracteres' })
  name?: string;

  @IsOptional()
  @IsString({ message: 'La descripción debe ser una cadena de texto' })
  description?: string;
}

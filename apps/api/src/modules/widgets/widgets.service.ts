import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Widget } from './entities/widget.entity';
import { CreateWidgetDto } from './dtos/create-widget.dto';
import { UpdateWidgetDto } from './dtos/update-widget.dto';

@Injectable()
export class WidgetsService {
  constructor(
    @InjectRepository(Widget)
    private readonly repository: Repository<Widget>,
  ) {}

  findAll(): Promise<Widget[]> {
    return this.repository.find();
  }

  async findOne(id: string): Promise<Widget> {
    const widget = await this.repository.findOne({ where: { id } });
    if (!widget) throw new NotFoundException('Widget not found');
    return widget;
  }

  create(dto: CreateWidgetDto): Promise<Widget> {
    return this.repository.save(this.repository.create(dto));
  }

  async update(id: string, dto: UpdateWidgetDto): Promise<Widget> {
    const widget = await this.findOne(id);
    Object.assign(widget, dto);
    return this.repository.save(widget);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.repository.softDelete(id);
  }
}

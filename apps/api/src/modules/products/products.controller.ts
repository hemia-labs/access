import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AccessAuthGuard } from '../../common/auth/access-auth.guard';
import type { AccessRequest } from '../../common/auth/access-actor.type';
import { CreateProductDto, EnableProductDto, ProductInstanceDto, UpdateProductDto } from './dtos/product.dto';
import { ProductsService } from './products.service';

@UseGuards(AccessAuthGuard)
@Controller()
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get('v1/products')
  findAll() {
    return this.products.findAll();
  }

  @Post('v1/products')
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Get('v1/products/:productCode')
  findOne(@Param('productCode') productCode: string) {
    return this.products.findOne(productCode);
  }

  @Patch('v1/products/:productCode')
  update(@Param('productCode') productCode: string, @Body() dto: UpdateProductDto) {
    return this.products.update(productCode, dto);
  }

  @Get('v1/organizations/:organizationId/products')
  findOrganizationProducts(@Param('organizationId', ParseUUIDPipe) organizationId: string) {
    return this.products.findOrganizationProducts(organizationId);
  }

  @Post('v1/organizations/:organizationId/products/:productCode/enable')
  enable(
    @Req() request: AccessRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('productCode') productCode: string,
    @Body() dto: EnableProductDto,
  ) {
    return this.products.enable(request.accessActor!, organizationId, productCode, dto);
  }

  @Post('v1/organizations/:organizationId/products/:productCode/suspend')
  suspend(@Req() request: AccessRequest, @Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('productCode') productCode: string) {
    return this.products.suspend(request.accessActor!, organizationId, productCode);
  }

  @Post('v1/organizations/:organizationId/products/:productCode/activate')
  activate(@Req() request: AccessRequest, @Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('productCode') productCode: string) {
    return this.products.activate(request.accessActor!, organizationId, productCode);
  }

  @Post('v1/organizations/:organizationId/products/:productCode/disable')
  disable(@Req() request: AccessRequest, @Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('productCode') productCode: string) {
    return this.products.disable(request.accessActor!, organizationId, productCode);
  }

  @Post('v1/internal/product-instances')
  recordInstance(@Req() request: AccessRequest, @Body() dto: ProductInstanceDto) {
    return this.products.recordInstance(request.accessActor!, dto);
  }
}

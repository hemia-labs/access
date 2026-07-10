---
name: frontend-design-system
description: >
  Design system para el frontend Next.js (apps/web) con Tailwind CSS v4 y shadcn
  (React). Usar cuando se cree, revise o modifique interfaces, componentes,
  páginas, formularios, dashboards, tablas, layouts, tokens de Tailwind, temas
  shadcn, o estilos UI light-only del frontend.
---

# Frontend Design System

## Objetivo

Construir UI de producto documental B2B: clara, densa, confiable y rápida de escanear.
El sistema es solo light mode. No crear dark mode, clases `dark:*`, toggles de tema ni variantes oscuras.

Stack objetivo:

- Next.js 16 (App Router) + React 19 + TypeScript.
- Tailwind CSS v4 con tokens CSS en `@theme inline` (`apps/web/src/app/globals.css`).
- shadcn (React) con CSS variables, iconos Lucide (`lucide-react`).
- Componentes de aplicación sobre primitives shadcn; no inventar sistema paralelo.

## Personalidad Visual

La UI debe sentirse como un workspace de documentación empresarial:

- Precisa, ordenada, sin decoración gratuita.
- Azul como acento de acción y navegación, no como baño monocromático.
- Superficies blancas sobre fondo azul muy pálido.
- Bordes suaves y sombras discretas para separar zonas.
- Mucho énfasis en legibilidad, tablas, filtros, estados y acciones claras.

Evitar landing-page aesthetics: heroes grandes, gradients decorativos, blobs, orbs, tarjetas anidadas, ilustraciones genéricas, exceso de purple/blue gradients.

## Tokens Base

Los tokens viven en `apps/web/src/app/globals.css` y se consumen con clases Tailwind semánticas
(`bg-card`, `text-muted-foreground`, `bg-sidebar`, `w-sidebar`, `h-topbar`, etc.). No redefinir; usar.

Paleta (light-only): `--background #f7faff`, `--foreground #07154a`, `--card #ffffff`,
`--primary #075cff`, `--secondary #eaf1ff`, `--muted #eef4ff`, `--muted-foreground #64719a`,
`--border #d9e2f4`, `--ring #075cff`, `--sidebar #02046f`, `--supporting #536180`,
`--surface-soft #edf2fb`, `--surface-line #e3e9f4`, `--destructive #ef4444`.

Layout tokens: `--layout-sidebar-width 18.25rem`, `--layout-sidebar-collapsed-width 5.5rem`,
`--layout-topbar-height 5.25rem` → clases `w-sidebar`, `w-sidebar-collapsed`, `h-topbar`,
`min-h-panel-min`, texto `text-2xs`.

## Color

Usar tokens semánticos primero:

- `background`: page canvas, azul casi blanco.
- `foreground`: texto principal, navy profundo.
- `card`: paneles, tablas, formularios, menús.
- `primary`: CTA principal, nav activo, links importantes, focus ring, iconos activos.
- `secondary`: fondos de icon badges, botones secundarios, filas destacadas suaves.
- `muted` / `muted-foreground`: empty states, headers suaves, metadata, helper text.
- `supporting`: texto de apoyo con más contraste que muted.
- `border` / `input`: bordes de cards, tablas, inputs.
- `ring`: focus visible.
- `sidebar`: navegación lateral fija; contraste fuerte.
- `surface-soft` / `surface-line`: bandas internas y divisores.
- `destructive`: errores y acciones destructivas.

Status colors: Success `emerald-600`/`emerald-400`; Danger `red-600` + `destructive`;
Warning `amber-500/600` + fondo `amber-50`; Info → `primary`/`secondary`;
Violet solo como acento menor `violet-50` + `violet-600`, nunca dominante.

Reglas:

- No usar hex inline salvo al definir tokens.
- No usar `slate-*` como base; preferir tokens.
- No usar gradients para fondos funcionales.
- No bajar contraste de texto bajo `muted-foreground`.
- Mantener sidebar navy; contenido principal claro.

## Tipografía

Fuente del proyecto (Geist, vía `next/font`). Scale:

- Page title: `text-2xl font-bold` o `text-3xl font-bold` solo en pantalla principal.
- Section title: `text-lg font-semibold`.
- Card title: `text-sm font-bold` o `text-base font-semibold`.
- Body: `text-sm`. Metadata: `text-xs text-muted-foreground`. Micro labels: `text-2xs`.

Reglas: tracking 0, sin tracking negativo; no escalar fuente con viewport; usar
`truncate`/`line-clamp-*`; números métricos en dashboards `text-2xl`/`text-3xl font-bold`.

## Altura mínima de items interactivos

Todo item interactivo o de control tiene altura mínima `h-12` (3rem): inputs, textareas,
selects, botones (incluidos icon buttons → `size-12`), items del sidebar, filas clicables,
triggers de dropdown/tabs. Usar `h-12` cuando la altura es fija o `min-h-12` cuando el
contenido puede crecer. Las sizes compactas de shadcn (`sm`, `xs`, `icon-sm`) son escape
hatches deliberados: usarlas solo en toolbars muy densos, nunca como default del producto.

## Espaciado y Layout

App shell:

- Sidebar desktop `w-sidebar` (18.25rem); colapsada `w-sidebar-collapsed` (5.5rem).
- Topbar `h-topbar` (5.25rem).
- Main: `bg-background`, padding `px-4 sm:px-6 lg:px-8`.

Paneles: cards `rounded-lg border border-border bg-card shadow-sm`; padding `p-5`/`p-6`;
tablas densas `px-4 py-3`; `min-h-panel-min` para cards de dashboard que deben alinear.

Grids: dashboard desktop 2+ columnas con `minmax(0,1fr)`; mobile 1 columna; tablas anchas en
`overflow-x-auto` con `min-w-*` estable.

Reglas: no cards dentro de cards; controles con dimensiones estables (botones icono `size-12`,
filas `min-h-12`, avatars `size-*`).

## Radius, Bordes, Sombras

- Radius base `0.5rem` (`rounded-lg`); botones/inputs `rounded-md`; icon badges `rounded-full`.
- Sombras: `shadow-sm` para cards; `shadow-lg shadow-blue-950/25` solo para nav activo o elevados.
- Bordes `border-border`; separadores `bg-surface-line` o shadcn `Separator`.
- No `rounded-2xl+` salvo excepción justificada.

## Componentes shadcn (React)

Usar primitives shadcn como base: `Button`, `Input`, `Textarea`, `Select`, `DropdownMenu`,
`Tooltip`, `Sheet`, `ScrollArea`, `Table`, `Tabs`, `Badge`, `Avatar`, `Skeleton`, `Separator`, `Card`.
Agregar con `bunx shadcn@latest add <comp>` desde `apps/web`.

Crear wrappers de producto solo si codifican una decisión repetida: `PageHeading`, `StatCard`,
`PanelTitle`, `AppBreadcrumb`, `VisibilityBadge`. Variantes con `class-variance-authority` (ya
incluido por shadcn) o, si son simples, con un map de clases tipado.

Button variants (las de shadcn):

- `default`: `bg-primary text-primary-foreground hover:bg-primary/90`.
- `secondary`: `bg-secondary text-secondary-foreground hover:bg-secondary/80`.
- `outline`: `border bg-background hover:bg-accent hover:text-accent-foreground`.
- `ghost`: `hover:bg-accent hover:text-accent-foreground`.
- `destructive`: `bg-destructive text-white hover:bg-destructive/90`.
- `link`: `text-primary underline-offset-4 hover:underline`.

Sizes: default `h-12 px-4`, `icon` → `size-12`. Compactas (`sm`, `xs`) solo en toolbars densos.
Todo icon button necesita `aria-label` y tooltip cuando el significado no es obvio.

## React Patterns

- Server Components por defecto. `"use client"` solo cuando haya estado, efectos o hooks de
  cliente (`usePathname`, `useState`, eventos). La navegación con estado activo (sidebar) es client.
- Props tipadas; defaults vía valores por defecto en la firma.
- Callbacks tipados en vez de emits: `onSave: (payload: FormPayload) => void`.
- Variantes visuales reutilizables = uniones de tipos, no strings libres.
- Componentes de vista orquestan; extraer paneles/filas repetidos.
- No meter lógica de fetch de negocio dentro de componentes UI de bajo nivel.

Forma de componente preferida:

```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  tone = "blue",
  icon,
}: {
  label: string;
  value: string;
  tone?: "blue" | "violet";
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div
        className={cn(
          "grid size-12 place-items-center rounded-full",
          tone === "violet" ? "bg-violet-50 text-violet-600" : "bg-secondary text-primary"
        )}
      >
        {icon}
      </div>
      <p className="mt-4 truncate text-sm font-bold">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}
```

## Forms

Inputs: `h-12 rounded-md border border-input bg-card px-3 text-sm`.
Focus: `focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50`.
Invalid: `aria-invalid:border-destructive aria-invalid:ring-destructive/20`.
Helper: `text-xs text-muted-foreground`. Error: `text-xs font-medium text-destructive`.

Layout: label arriba en forms simples; dos columnas (label/help izq, input der) en settings.
Indicadores de requerido no solo por color. Forms largos con headings y `Separator`.

## Tables and Lists

Tablas son first-class:

- Header `text-xs font-semibold text-muted-foreground`. Row `text-sm`.
- Hover `hover:bg-muted/60`. Fila activa `bg-secondary`. Celdas `px-4 py-3`.
- `min-w-*` + scroll horizontal para tablas anchas.
- Acciones a la derecha; destructiva detrás de menú o confirmación.
- Empty state dentro de la superficie de la tabla, no hero full-page.

## Navigation

Sidebar:

- Fondo `bg-sidebar`, texto `text-sidebar-foreground`.
- Activo: `bg-primary text-primary-foreground shadow-lg shadow-blue-950/25`.
- Inactivo: `bg-transparent text-blue-50/95 hover:bg-white/10 hover:text-white`.
- Estado activo con `usePathname()` (client). Labels colapsados → `sr-only` + tooltip.
- Status del sistema con punto `emerald-400`.

Topbar: blanca/transparente sobre el fondo; búsqueda/acciones a la derecha; título/breadcrumbs a la izquierda.

## Badges and Status

- Neutral `bg-muted text-muted-foreground`. Primary/info `bg-secondary text-primary`.
- Success `bg-emerald-50 text-emerald-700`. Warning `bg-amber-50 text-amber-700`.
- Danger `bg-red-50 text-red-700`. Violet `bg-violet-50 text-violet-600`.

Badges = sustantivos/estados cortos, no frases.

## Motion

- Sidebar width: `transition-all duration-300 ease-in-out`.
- Hover/focus: `transition-colors` o defaults de shadcn.
- Sin animación grande de entrada de página. Respetar `prefers-reduced-motion`.

## Accessibility

- Todo control alcanzable por teclado. Focus ring visible con `ring`.
- Icon-only buttons con `aria-label`. Tooltip es soporte, no único label.
- Errores de form ligados con `aria-describedby`.
- Color nunca único señal de estado; sumar texto/icono.
- Contraste legible sobre `secondary`, `muted` y sidebar.

## Implementation Checklist

Antes de terminar trabajo de UI:

- Usa tokens semánticos, no hex random.
- Sin clases dark mode ni theme toggle.
- Primitives shadcn donde corresponde.
- Texto entra en mobile y desktop.
- Tablas/listas con anchos estables y scroll definido.
- Botones con variant/size correcto y labels en icon buttons.
- Existen estados empty/loading/error.
- Sin nested cards, blobs, gradients decorativos ni baño monocromático.
- Props tipadas; `"use client"` solo donde hace falta.
- Correr lint/typecheck/build: `bun run --cwd apps/web build`.

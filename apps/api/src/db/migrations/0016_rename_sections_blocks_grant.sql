-- Hand-written (API step 3): the secretary renames sections and blocks (2.3 PATCH /secciones,
-- /manzanas). Codes stay immutable: they form the visible block code (S1-M03) used by
-- payments, closings and reports. Every rename is audited by the organization service.
GRANT UPDATE (name) ON section TO agua_api;
--> statement-breakpoint
GRANT UPDATE (name) ON block TO agua_api;

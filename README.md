# Bella Vista payment system — API

API del sistema de cobro de agua de la comunidad Bella Vista. Monorepo con pnpm: `apps/api` (Fastify + PostgreSQL) y `packages/shared` (esquemas y reglas de negocio compartidas con la futura app móvil).

La forma recomendada de trabajar es el **Dev Container**: VS Code, la terminal, Git, Claude Code y la API corren dentro de Docker, así que en su equipo no necesita Node.

## Con Dev Container (recomendado)

### Requisitos en Windows

El proyecto debe vivir **dentro de WSL** (Ubuntu), no en `C:\`: desde `C:\` la recarga en caliente falla y todo es mucho más lento.

1. Docker Desktop con *Use the WSL 2 based engine* activado y, en *Settings → Resources → WSL integration*, Ubuntu activado.
2. Ubuntu en WSL: en PowerShell como administrador, `wsl --install -d Ubuntu`, y reinicie.
3. VS Code para Windows con las extensiones **WSL** y **Dev Containers**.
4. En la terminal de Ubuntu: `sudo apt update && sudo apt install -y git unzip` y configure Git (`git config --global user.name "..."`, `git config --global user.email "..."`).
5. Ponga el proyecto en Ubuntu y ábralo desde ahí:
   ```bash
   mkdir -p ~/proyectos && cd ~/proyectos
   git clone https://github.com/Snilux/Bella-Vista-payment-system-API.git
   cd Bella-Vista-payment-system-API && code .
   ```

### Requisitos en Linux

- Docker con Compose y Buildx. En Arch Linux:
  ```bash
  sudo pacman -S --needed git docker docker-compose docker-buildx
  sudo systemctl enable --now docker.service
  sudo usermod -aG docker $USER      # cierre sesión y vuelva a entrar
  ```
- VS Code de Microsoft (en Arch: `visual-studio-code-bin` del AUR) con la extensión **Dev Containers** (`ms-vscode-remote.remote-containers`).

### Primer arranque

1. Abra el proyecto en VS Code (en Windows, desde Ubuntu con `code .`).
2. Acepte **Reopen in Container** (o `Ctrl+Shift+P` → *Dev Containers: Reopen in Container*).
3. La primera vez tarda unos minutos: construye la imagen, levanta PostgreSQL, crea el repositorio Git si no existe, copia `.env.example` a `.env` e instala dependencias.
4. En la terminal de VS Code (ya está dentro del contenedor):
   ```bash
   pnpm dev                              # inicia la API con recarga en caliente
   curl http://localhost:3000/health     # {"status":"ok"}
   claude                                # Claude Code; la primera vez pide iniciar sesión
   ```

Su identidad de Git y su llave SSH se usan dentro del contenedor automáticamente. Los archivos que se crean dentro quedan a nombre de su usuario. La sesión de Claude Code se guarda en un volumen y sobrevive a reconstruir el contenedor.

### Comandos dentro del contenedor

| Comando | Qué hace |
|---|---|
| `pnpm dev` | API en http://localhost:3000 con recarga en caliente |
| `pnpm check` | Lint, tipos y pruebas |
| `pnpm db:generate` | Genera una migración desde el esquema |
| `pnpm db:migrate` | Aplica las migraciones y ajusta la contraseña de `agua_api` a la de `DATABASE_URL` |
| `pnpm db:studio` | Explorador de la base de datos de Drizzle |
| `claude` | Claude Code (use `/commit` para los commits) |

Los scripts `pnpm docker:*` son para usar el proyecto **sin** Dev Container; dentro del contenedor no hay Docker.

### Mantenimiento

- **Agregó o cambió dependencias en `package.json`:** `pnpm install` en la terminal del contenedor.
- **Cambió el Dockerfile o `.devcontainer/`:** *Dev Containers: Rebuild Container*.
- **Borrar los datos de la base:** desde su equipo, con VS Code cerrado, `docker compose down -v`.

## Sin Dev Container

Requiere además Node.js 24 (`.nvmrc`) y Corepack (en Arch: `nodejs-lts-krypton corepack`).

```bash
git init -b main             # antes de instalar, para que se activen los hooks de commits
cp .env.example .env
corepack enable
pnpm install
pnpm docker:up               # PostgreSQL y la API en contenedores
curl http://localhost:3000/health
```

| Comando | Qué hace |
|---|---|
| `pnpm docker:logs` / `pnpm docker:down` | Ver logs / detener |
| `pnpm docker:rebuild` | Reconstruir la API tras cambiar dependencias |
| `pnpm docker:reset-db` | Borrar los datos de la base y empezar de cero |
| `docker compose exec api pnpm db:migrate` | Aplicar migraciones (y ajustar la contraseña de `agua_api`) |

No use al mismo tiempo el Dev Container y `pnpm docker:up`: comparten los mismos contenedores.

## Base de datos

Desde su equipo (DBeaver, TablePlus): `localhost:5432`, usuario `agua`, contraseña `agua_local`, bases `agua` y `agua_test`. Si ya tiene PostgreSQL instalado y ocupando el 5432, detenga ese servicio o cambie `DB_PORT` en `.env`.

La API se conecta como `agua_api`, con permisos limitados. Su contraseña sale **solo** de `DATABASE_URL` en `.env`: cada `pnpm db:migrate` se conecta como el dueño (`DATABASE_URL_MIGRATIONS`), aplica las migraciones y le asigna al rol esa contraseña, también en una base que ya existía (el rol es del servidor, así que sirve igual para `agua` y `agua_test`). Si cambia `DATABASE_URL`, reconstruya el contenedor (*Dev Containers: Rebuild Container*, o `pnpm docker:up` sin Dev Container) para que tome el valor nuevo y ejecute `pnpm db:migrate`. Si `pnpm dev` o `pnpm db:seed:dev` fallan con `password authentication failed for user "agua_api"`, ejecute `pnpm db:migrate`.

## Datos de desarrollo

Con la base migrada, cargue el arranque y los datos de prueba (solo en desarrollo: `pnpm db:seed:dev` se niega con `NODE_ENV=production`):

```bash
cp arranque.example.json arranque.json   # la primera vez
pnpm db:seed                             # arranque (D-27): superadministrador y comité
pnpm db:seed:dev                         # secciones, manzanas, personas, tomas, tarifas, pagos y cuentas
```

### Cuentas de desarrollo

Todas usan la contraseña `desarrollo-bella-vista` y no piden cambiarla. `pnpm db:seed:dev` también se la asigna al superadministrador del arranque (cada vez que se ejecuta, aunque los datos ya existan).

| Usuario | Cargo | Manzana |
|---|---|---|
| `admin` | Superadministrador (el `usuario` de `arranque.json`) | — |
| `presidente` | Presidente | — |
| `tesorero` | Tesorero | — |
| `secretario` | Secretario | — |
| `vocal` | Vocal | — |
| `jm.s1m01` | Jefe de manzana | S1-M01 (Sección Centro) |
| `jm.s1m02` | Jefe de manzana | S1-M02 (Sección Centro) |
| `jm.s2m01` | Jefe de manzana | S2-M01 (Sección Lomas) |

S2-M02 queda sin jefe a propósito. Si las cuentas de presidente, tesorero o secretario ya las había creado el superadministrador desde la app, `pnpm db:seed:dev` las respeta y conservan su contraseña.

### Probar la API a mano (REST Client)

La carpeta `http/` tiene un archivo por escenario para la extensión **REST Client** (`humao.rest-client`, ya incluida en el Dev Container). Con `pnpm dev` corriendo, abra un archivo y use *Send Request* sobre cada petición, **en orden**: los login guardan su token en una variable que usan las peticiones siguientes. Cada petición indica en un comentario lo que debe responder.

| Archivo | Escenario |
|---|---|
| `00-sesion.http` | Salud, login de cada cargo, refresco, cambio de contraseña (y regreso a la de desarrollo), salir |
| `01-cobro.http` | El jefe busca una familia con adeudo, estado de cuenta, previsualizar, registrar pago, repetirlo con la misma `Idempotency-Key`, meses salteados (`MONTH_ORDER`) y Mi caja |
| `02-entregas.http` | Entrega del jefe, el tesorero la confirma con faltante, saldo de ambas cajas |
| `03-autorizaciones.http` | El jefe solicita cancelar el pago de `01`, el presidente lo autoriza y los meses vuelven a vencidos |
| `04-padron.http` | Persona con homónimo, familia nueva en una toma, solicitud de toma y su cancelación |
| `05-comite.http` | Acuerdo, tarifa, ingreso, gasto, fontanero, corte mensual y reportes |
| `06-permisos.http` | Casos que deben fallar: jefe en otra manzana, vocal registrando un gasto, presidente registrando una persona |

Los importes de los comentarios son los de una base recién cargada con `pnpm db:seed:dev` en noviembre de 2026; cambian con la fecha y con lo que ya se haya ejecutado. `01` y `03` se pueden repetir en ese orden (`03` cancela el pago de `01`). El login y el refresco aceptan 10 solicitudes por minuto por IP: si alguna responde 429, espere un minuto.

## Documentación

- `CLAUDE.md`: contexto y reglas para Claude Code.
- `CONTRIBUTING.md`: idioma (código y commits en inglés) y formato de commits.
- `docs/`: reglas de negocio, modelo de datos, contrato de API, estructura del código y glosario español → inglés.

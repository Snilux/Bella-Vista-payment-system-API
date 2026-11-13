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
| `pnpm db:migrate` | Aplica las migraciones |
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
| `docker compose exec api pnpm db:migrate` | Aplicar migraciones |

No use al mismo tiempo el Dev Container y `pnpm docker:up`: comparten los mismos contenedores.

## Base de datos

Desde su equipo (DBeaver, TablePlus): `localhost:5432`, usuario `agua`, contraseña `agua_local`, bases `agua` y `agua_test`. Si ya tiene PostgreSQL instalado y ocupando el 5432, detenga ese servicio o cambie `DB_PORT` en `.env`.

## Documentación

- `CLAUDE.md`: contexto y reglas para Claude Code.
- `CONTRIBUTING.md`: idioma (código y commits en inglés) y formato de commits.
- `docs/`: reglas de negocio, modelo de datos, contrato de API, estructura del código y glosario español → inglés.

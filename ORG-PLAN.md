# BYOS for organisations: plan

Status: planned, not started. Decisions below were agreed on 2026-10-07.

## What we're building

The same BYOS app, used by teams. People sign in with GitHub, work inside an
organisation's shared drive, and what each person can see and change is set by
their role and by per-folder access, the way GitHub handles organisations and
repositories. Personal BYOS keeps working exactly as it does today.

## Decisions

| Question | Decision |
|---|---|
| Separate app or the same app? | Same app. A **workspace switcher** moves between your personal drive and any orgs you're in. |
| Storage for orgs | **S3-compatible** (S3, R2, B2, MinIO) **and** a **repository in the GitHub organisation**. Telegram is personal only. |
| Roles | The four built-in roles (Owner, Admin, Member, Viewer) **plus custom roles**, with **per-folder access** like GitHub repositories. |
| Folder permissions | In **v1**. |
| What Members can delete | **Their own files only** (files they uploaded or created). |
| Bao | Bao can never do anything the person asking couldn't do themselves. Every Bao change goes through the same code path as the normal endpoint, with the same checks and side effects. |

## Concepts

- **Workspace.** What owns files, folders, links, storage, AI keys, API keys,
  webhooks and the audit log. Every user has one **personal workspace** (today's
  drive) and can belong to any number of **org workspaces**.
- **Member.** A user in a workspace, with one **role**. A personal workspace has
  exactly one member, its owner.
- **Role.** A named set of **permissions** at workspace level. Built-in roles
  can't be edited; custom roles are made by Owners/Admins from the permission
  list.
- **Team** (optional in v1, recommended). A group of members, so folder access
  can be granted to "Design" instead of five people, as in GitHub.
- **Folder access.** A grant on a folder to a member or team, at one of four
  levels: **Read**, **Write**, **Manage** or **No access**. Access flows down to
  subfolders unless a subfolder sets its own. A folder can be **restricted**,
  which turns off the workspace-wide default for it (the "private repo" case).
- **Base access.** The default folder access every member gets everywhere
  (GitHub's "base permissions"): Read, Write or No access. Restricted folders
  ignore it.

### Built-in roles

| | Owner | Admin | Member | Viewer |
|---|---|---|---|---|
| See and download (where folder access allows) | ✓ | ✓ | ✓ | ✓ |
| Upload, rename, move, tag (where folder access is Write+) | ✓ | ✓ | ✓ | – |
| Delete files | any | any | **own only** | – |
| Create folders, manage folder access (on Manage) | ✓ | ✓ | where granted Manage | – |
| Public links (subject to policy) | ✓ | ✓ | if policy allows | – |
| Members, invites, roles, teams | ✓ | ✓ | – | – |
| Storage, org AI keys, policies, webhooks | ✓ | ✓ | – | – |
| Audit log | ✓ | ✓ | – | – |
| Delete the org, transfer ownership, billing | ✓ | – | – | – |

Owners and Admins bypass folder restrictions (they can always see and fix
access); everyone else gets the **higher** of base access and any grant that
applies to them (direct or via a team), except in restricted folders, where only
grants count.

### Permissions (the building blocks for custom roles)

Workspace-level, each a yes/no on a role:

- `files.read`, `files.write`, `files.delete_own`, `files.delete_any`
- `folders.create`, `folders.manage_access`
- `links.create_public`, `links.create_expiring`
- `members.invite`, `members.manage`, `roles.manage`, `teams.manage`
- `storage.manage`, `ai_keys.manage`, `ai.use`, `ai.max_mode` (read_only / ask / auto / full)
- `api_keys.create`, `webhooks.manage`, `audit.read`, `policies.manage`

Effective permission for an action = the role grants the permission **and**
folder access on the target allows it (Read for reading, Write for changes,
Manage for access changes). Both checks always run.

## Sign-in

- **GitHub OAuth** becomes a first-class sign-in, for everyone (personal users
  can use it too). Scopes: `read:user`, `user:email`, `read:org` (for
  auto-join).
- One user can have several **identities** (GitHub, Telegram, password). New
  `user_identities` table; linking from Settings → Profile.
- **Org policy "sign in with GitHub only."** Members of that org must use their
  GitHub identity to open it; Telegram/password sessions see the org as locked.
- **Joining:**
  - Invite by GitHub username or by an expiring invite link (with a preset role).
  - Optional **auto-join**: anyone in a chosen GitHub organisation becomes a
    Member automatically, checked against GitHub's org membership at sign-in.
- Removing someone from the GitHub org removes them on their next sign-in (and
  we re-check periodically).

## Storage for orgs

- Credentials belong to the workspace; only `storage.manage` can see or change
  them.
- **S3-compatible:** the default recommendation (built for teams, big files,
  many writers).
- **GitHub org repository:** release-asset storage in a repo owned by the GitHub
  org; same limits as personal GitHub storage (2 GB per file, not meant for heavy
  hosting), stated plainly in the connect dialog.
- Default storage per workspace; folders can optionally pin a storage.

## Bao in an org

The rule: **Bao is the person asking, nothing more.**

1. **Same code path.** Every Bao change calls the same service function the
   endpoint calls, through the same authorisation check, and triggers the same
   side effects (webhooks, audit log). Already true today for permissions; the
   two side effects Bao was skipping (the `file.deleted` webhook and audit entry
   on delete, and the audit entry on share creation) were fixed on 2026-10-07 in
   `ai/tools.py`.
2. **Tools follow permissions.** Bao is only offered tools the person can use
   (no `delete_file` for a Viewer; `delete_file` for a Member only works on their
   own files). Reading tools only return files the person can read.
3. **Checked again at apply time.** A plan proposed earlier is re-authorised
   when applied, since access can change in between.
4. **Mode capped by role** (`ai.max_mode`): e.g. Viewers read only, Members up
   to Ask first.
5. **Search and answers respect folder access.** Indexed chunks are filtered by
   the asker's readable folders before retrieval, so answers can't quote a
   restricted folder. This is the biggest leak risk; it gets its own tests.
6. **Org AI keys.** Admins add keys; members can use them without seeing them.
   Personal keys stay personal and aren't usable in an org unless the org allows
   "bring your own key".
7. **Audit.** Bao actions are logged as the person, with `via = "bao"`.

## Links and sharing

- Org links live under the org's handle: `/acme/q3-report`.
- Policies (`policies.manage`): allow public links or not, force expiry on
  expiring links, restrict link creation to roles.
- A link to a file in a restricted folder can only be made by someone with
  Manage there.

## API keys, webhooks, audit

- **API keys** belong to a member in a workspace. A key's access is the lower of
  its scopes and the member's current role and folder access, re-checked on every
  request; removing the member kills the key.
- **Webhooks** are workspace-level (`webhooks.manage`); events carry the actor.
- **Audit log** gains `workspace_id`, `actor_id` and `via` (`app`, `api`,
  `bao`). Org audit page for `audit.read`.

## Data model changes

New tables:

- `workspaces` (id, kind `personal`/`org`, name, handle, policies JSON,
  default_storage_id, github_org, created_at)
- `workspace_members` (workspace_id, user_id, role_id, joined_at)
- `roles` (id, workspace_id null for built-ins, name, permissions JSON,
  is_builtin)
- `teams`, `team_members`
- `folder_grants` (folder_id, member_id or team_id, level), plus
  `folders.restricted` and `workspaces.base_access`
- `invitations` (workspace_id, github_login or token, role_id, expires_at)
- `user_identities` (user_id, provider, provider_user_id, login, linked_at)

Columns:

- `workspace_id` on files, folders, tags, aliases, shares, storage_accounts,
  ai_keys, ai_prompts, ai_conversations, ai_action_plans, ai_file_chunks,
  api_keys, webhooks, audit_logs.
- `created_by` on files and folders (for "delete own files only").
- Uniqueness that is per-user today becomes per-workspace (alias slugs, tag
  names).

Migration:

- Create a personal workspace for every existing user.
- Backfill `workspace_id` from `owner_id`/`user_id` and `created_by` from the
  owner.
- Keep `owner_id` for one release as a fallback, then drop it.
- The migration is written so the user runs it on production themselves, as
  with every migration.

## Authorisation layer (backend)

- An `Actor` (user, workspace, member, role, effective permissions, readable and
  writable folder sets) replaces the bare `user` that services take today.
- One `authorize(actor, permission, target)` used by **every** service function;
  routers and Bao's tools both go through the services, so neither can skip it.
- Listing and search queries filter by `workspace_id` and the actor's readable
  folders. The readable-folder set is computed once per request (folder tree
  plus grants) and cached briefly.
- The active workspace comes from the request (an `X-Workspace` header set by
  the app, or the workspace on an API key).

## App changes (web)

- **Workspace switcher** at the top of the Drive sidebar and the BYOK sidebar
  (and in the phone More sheet). Shows personal + orgs, and "Create organisation".
- **Org onboarding:** name and handle → connect storage (S3 or GitHub org repo) →
  invite people (GitHub usernames, invite link, or auto-join from a GitHub org).
- **Settings split:** Personal (profile, identities, appearance) and Workspace
  (members, teams, roles, folder defaults, storage, AI keys, policies, API keys,
  webhooks, audit).
- **Members page:** list, role picker, remove, pending invites.
- **Roles page:** built-in roles shown read-only; custom role editor as a
  grouped permission checklist with a preview of what the role can do.
- **Folder "Manage access" dialog** (like GitHub's collaborators page): base
  access, restricted toggle, and grants to members/teams with Read/Write/Manage.
  A lock icon marks restricted folders in the Drive.
- **UI follows permissions:** actions a person can't take are hidden or disabled
  with a reason ("Only the uploader or an admin can delete this"), never left to
  fail on click.
- **Sign-in page:** "Continue with GitHub" as the first option; Telegram and
  password stay for personal use.

## Phases

1. **Foundation.** Workspaces, members, built-in roles, `Actor` +
   `authorize()` through every service, personal-workspace migration. No
   visible change for existing users. Exit: all current tests pass through the
   new layer; Bao and endpoints share it.
2. **GitHub sign-in + identities.** OAuth, linking, "GitHub only" policy.
3. **Orgs v1.** Create org, switcher, invites, auto-join, S3 + GitHub-repo
   storage, org AI keys, members page, `created_by` + delete-own rule.
4. **Folder access + custom roles + teams.** Grants, restricted folders, base
   access, role editor, Manage access dialog; search/RAG filtering by folder.
5. **Bao in orgs.** Tool filtering by permission, re-authorisation at apply, mode
   caps, audit `via = bao`.
6. **Links, API keys, webhooks, audit for orgs.** Org namespace, policies,
   member-bound API keys, org audit page.

## Tests that must exist

- Permission matrix: each built-in role × each action, allowed and denied.
- Folder access: inheritance, restricted folders, base access, team grants,
  higher-of rule, Owner/Admin override.
- "Delete own only" for Members, including via Bao and via API key.
- Bao: no tool offered or executed beyond the asker's permissions; a plan made
  by an Admin and applied after their demotion is refused.
- RAG/search never returns chunks or files from a folder the asker can't read.
- API key access shrinks immediately when the member's role does.
- Migration: every existing user ends up with a personal workspace owning all
  their data; nothing else changes for them.

## Open questions (to settle before Phase 3)

- Do org members get an "org-only" account, or must every org member also have a
  personal workspace?
- Seat limits or billing for orgs, if ever?
- Email notifications (invites, access requests) or GitHub-only notices?
- Can a member request access to a restricted folder from inside the app?

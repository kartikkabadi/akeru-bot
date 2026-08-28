# Configure bots

Open a bot to edit its profile in the panel beside the conversation.

- Select the avatar to change its shape, color, generated image, or uploaded image.
- Set the bot name.
- Add an optional label and description.
- Choose the model that the bot uses.
- Open **Tools** to choose which installed plugins and MCP servers the bot can use. New tools are enabled for every bot by default.
- Select **Save** to apply profile, model, and tool changes.

Akeru Bot stores the profile in the connected environment. Other clients connected to the same environment see the same bot configuration. Workspace-disabled tools stay unavailable to all bots.

Use the panel button to collapse or reopen the editor. The default shortcut is **Mod+Alt+B**, and you can change `Right Panel: Toggle` in the keybinding settings. On a narrow screen, the same button opens a sheet.

When a request needs tools, the bot first replies in plain language. During longer work, it adds short status notes after meaningful progress. When work resumes automatically, it continues without a repeated opening note.

Bot replies support headings, links, tables, task lists, code blocks, math, and Mermaid diagrams.

# claude-code-plugins

Small Claude Code plugins that change the terminal interface. Each plugin is
a hooks module. No plugin adds a skill, an agent, or an MCP server.

| Plugin | What it does | Command |
|--------|--------------|---------|
| [usage-footer](plugins/usage-footer) | Shows the weekly and 5-hour plan usage on the right of the footer row. | None |
| [screenshot-pane](plugins/screenshot-pane) | Shows PNG and JPEG files from tool calls in a side pane. | `/shots` |
| [pr-link](plugins/pr-link) | Shows a link and a status circle above the prompt for each PR that `gh pr create` opens. | None |
| [session-plan](plugins/session-plan) | Keeps a short plan of the session (goal, now, next, done) in a side pane. | `/progress` |
| [session-picker](plugins/session-picker) | Shows the recent sessions in this directory. Press a row to resume it. | `/sessions` |

## Install

Add the marketplace:

```text
/plugin marketplace add BlueprintGreg/claude-code-plugins
```

Install one plugin:

```text
/plugin install usage-footer@greg-plugins
```

Restart the session after you install a plugin. A session that started
before the install does not load it.

## Notes for each plugin

### usage-footer

The plugin reads the plan rate limits from the session. The numbers show
after the first response. The color changes to yellow at 70% and to red at
90%. The reset time is a countdown, so it does not depend on the time zone.

### screenshot-pane

- The plugin works on macOS only. It uses `sips` to read image sizes and to
  convert JPEG files, and `open` to open a file.
- The pane draws images with the kitty graphics protocol. Use Ghostty or
  kitty. Other terminals show the alt text.
- The pane opens when a `Read` call opens an image, or when a `Bash` call
  writes one. If you close the pane, a new image does not open it again.
- `/shots` opens the pane. `/shots clear` empties it.

### pr-link

The band shows the three newest PRs. The **Clear** button empties the list.
The list lasts for one session only.

A circle in front of each PR shows its status. The plugin gets the status
with `gh pr view`, so it needs the GitHub CLI, signed in.

| Circle | Status |
|--------|--------|
| ● yellow | Open, waiting for review |
| ● green | Approved |
| ● red | Changes requested |
| ● magenta | Merged |
| ● gray | Closed without a merge |
| ○ gray | Draft |
| ● dim | Loading, or `gh` could not get the status |

The plugin checks an open PR again every 2 minutes. It checks a merged or
closed PR again every 30 minutes.

### session-plan

- After each turn, the plugin sends the new session activity to Haiku. Haiku
  returns an updated plan. **Each update uses your plan usage or API
  credits.**
- System reminders are removed before the plugin sends the activity.
- The plan shows in the hint line under the prompt and in a side pane.
- `/progress` opens or closes the pane. `/progress refresh` rebuilds the plan
  from the full transcript. `/progress clear` resets it.

### session-picker

A **Recent sessions** button shows above the prompt until you send the first
prompt. `/sessions` opens the pane at any time. Keys 1 to 9 resume the row
with that number.

## Tests

Each plugin has tests. Run them with:

```sh
claude plugin test plugins/<name>
```

## License

[MIT](LICENSE)

# Install Skillbrew in OpenCode

Add Skillbrew to the `plugin` array in your global or project-level `opencode.json`:

```json
{
  "plugin": ["@redox/skillbrew@git+https://github.com/redox/skillbrew.git"]
}
```

Restart OpenCode. The plugin registers the repository's generated `skills/` directory with OpenCode's native skill system.

To pin a release, append its Git tag to the repository URL:

```json
{
  "plugin": ["@redox/skillbrew@git+https://github.com/redox/skillbrew.git#v0.1.0"]
}
```

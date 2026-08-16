# Windows Computer Use — Script Quick Reference

Script: `D:\dasha\WORKSPACE\computer_use.py`
Python: `/c/Program Files/Python310/python.exe`

## Calling Convention (git-bash)

```
MSYS2_NO_PATHCONV=1 /c/Program\ Files/Python310/python.exe /d/dasha/WORKSPACE/computer_use.py <command> [args]
```

## Commands Quick Table

| Command | Args | Output |
|---------|------|--------|
| `capture --vision` | — | JSON with `screenshot_b64`, `width`, `height` |
| `capture -o file.png` | save path | File saved |
| `click x y [button]` | x y (left/right/middle) | JSON ok |
| `doubleclick x y` | x y | JSON ok |
| `rightclick x y` | x y | JSON ok |
| `move x y` | x y | JSON ok |
| `type "text"` | text to type | JSON ok |
| `key keyname` | e.g. enter, escape, tab | JSON ok |
| `hotkey k1 k2 ...` | e.g. ctrl c, alt tab | JSON ok |
| `scroll clicks` | +up / -down | JSON ok |
| `drag x1 y1 x2 y2` | from→to | JSON ok |
| `position` | — | JSON x, y |
| `screen_size` | — | JSON width, height |
| `windows` | — | JSON window list |
| `focus "title"` | partial title | JSON ok |
| `wait seconds` | e.g. 2.0 | JSON ok |

## key_name reference (pyautogui)

Common keys: enter, escape, tab, backspace, delete, space, home, end, pageup, pagedown, up, down, left, right, f1-f24, ctrl, alt, shift, win, caps_lock, num_lock, scroll_lock, insert, printscreen, pause

## Return Formats

### capture --vision
```json
{
  "action": "capture",
  "width": 1920,
  "height": 1080,
  "timestamp": "2026-05-25T16:43:00",
  "screenshot_b64": "iVBORw0KG..."
}
```

### windows
```json
{
  "action": "list_windows",
  "windows": ["微信", "Chrome", "Foxmail", ...],
  "count": 15
}
```

### Action commands (click, move, type, etc.)
```json
{"action": "click", "x": 500, "y": 400, "button": "left", "ok": true}
```

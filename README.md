# Agents Office

A live viewer for a three-agent AI pipeline that works through an assignment:

1. **Analyst** reads the brief and turns it into a checkable to-do list.
2. **Source finder** looks up docs, tutorials and past work for every item.
3. **Builder** does the work and checks it against the to-do list.

**Live demo:** https://dhaswin86.github.io/agents-office/

## What you'll see
- **A 360° office:** three team rooms around "The Brain" hub, each with three animated workers. Drag to turn it, pinch or ⌘ + scroll to zoom, and click a room to go inside.
- **A 3D room for each team**, with its own workers busy at their jobs.
- **Task Status as a story:** every step in plain words, who did it, and which websites were used.

## About this copy
This is a static demo with made-up data ("Build a Simple To-Do App"), so no real assignment content is published. The real viewer runs locally against private assignment folders.

Built with plain HTML/JS and [Three.js](https://threejs.org/) r128.

## Tests
`tests/test_office.py` is a Playwright check of the whole viewer (29 checks: 3D office, camera controls, clicking into rooms, the story, phone layout, no JS errors):

```
python3 -m http.server 8840 &
python3 tests/test_office.py http://localhost:8840 /tmp
```

#!/usr/bin/env python3
"""End-to-end checks for the Agents Office viewer, run against the static demo build.

  python3 build_static.py /tmp/ao-test
  python3 ~/.claude/skills/webapp-testing/scripts/with_server.py \
      --server "python3 -m http.server 8840 --directory /tmp/ao-test" --port 8840 \
      -- python3 tests/test_office.py http://localhost:8840 <screenshot-dir>

Prints one line per check and exits non-zero if any check fails.
"""
import sys, os
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8840"
SHOTS = sys.argv[2] if len(sys.argv) > 2 else "/tmp"
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


def view(page, which="office3d"):
    return page.evaluate(f"{which} && {which}.view")


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

    # --- home: the 360° office ---
    page.goto(BASE + "/#/")
    page.wait_for_load_state("networkidle")
    page.wait_for_selector("#office3d canvas", timeout=15000)
    page.wait_for_timeout(1500)
    page.screenshot(path=os.path.join(SHOTS, "test-home.png"))
    check("home renders the 3D office canvas", page.locator("#office3d canvas").count() == 1)
    check("three room cards float over the office", page.locator(".s3-room").count() == 3)
    check("The Brain label is shown", page.locator(".s3-brain").count() == 1)
    links = page.evaluate("office3d.built.links.length")
    check("dotted links are drawn", links >= 5, f"{links} links")
    check("auto-spin is off by default", view(page)["auto"] is False)

    upper = page.evaluate("""[...document.querySelectorAll('body *')].filter(e => getComputedStyle(e).textTransform === 'uppercase' && e.textContent.trim()).length""")
    check("no ALL-CAPS labels", upper == 0, f"{upper} uppercase elements")

    # --- camera controls ---
    r0 = view(page)["r"]
    page.click("[data-3d=in]"); page.wait_for_timeout(1200)
    r1 = view(page)["r"]
    check("zoom-in button moves the camera closer", r1 < r0 - 1, f"{r0} -> {r1}")
    page.click("[data-3d=reset]"); page.wait_for_timeout(1500)
    check("reset button glides back", abs(view(page)["r"] - r0) < 1, f"r={view(page)['r']}")
    page.click("[data-3d=spin]"); t0 = view(page)["theta"]; page.wait_for_timeout(5000); t1 = view(page)["theta"]
    check("spin button turns the office", t1 - t0 > 0.1, f"theta {t0} -> {t1}")
    page.click("[data-3d=spin]")

    box = page.locator("#office3d canvas").bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    r_before = view(page)["r"]
    page.mouse.move(cx, cy); page.mouse.wheel(0, 400); page.wait_for_timeout(800)
    check("plain scroll does not zoom (page can scroll)", abs(view(page)["r"] - r_before) < 0.5)
    page.keyboard.down("Control"); page.mouse.wheel(0, 200); page.keyboard.up("Control"); page.wait_for_timeout(1200)
    check("Ctrl + scroll zooms", abs(view(page)["r"] - r_before) > 1, f"{r_before} -> {view(page)['r']}")
    page.click("[data-3d=reset]"); page.wait_for_timeout(1500)

    th = view(page)["theta"]
    dx, dy = box["x"] + box["width"] * 0.8, box["y"] + box["height"] * 0.85   # open floor, away from the room cards
    page.mouse.move(dx, dy); page.mouse.down(); page.mouse.move(dx - 220, dy, steps=8); page.mouse.up(); page.wait_for_timeout(800)
    check("dragging turns the office", abs(view(page)["theta"] - th) > 0.5, f"theta {th} -> {view(page)['theta']}")
    page.click("[data-3d=reset]"); page.wait_for_timeout(1500)

    # --- hover + click a room in 3D ---
    x, y = page.evaluate("office3d.screenOf(11, 0.5, -7)")
    page.mouse.move(x, y); page.wait_for_timeout(500)
    hot = page.evaluate("(document.querySelector('.s3-room.hot') || {}).dataset?.go || null")
    check("hovering the blue room highlights its card", hot == "finder", f"hot={hot}")
    page.mouse.click(x, y); page.wait_for_timeout(1500)
    check("clicking the blue room opens the Source finder page", page.url.endswith("#/finder"), page.url)
    check("the team page shows its 3D room", page.locator("#stage3d canvas").count() == 1)
    tags = page.locator("#stage3d .s3-tag").count()
    check("the room labels its 3 workers", tags == 3, f"{tags} tags")
    page.screenshot(path=os.path.join(SHOTS, "test-finder-room.png"))

    # --- room cards also navigate ---
    page.goto(BASE + "/#/"); page.wait_for_selector("#office3d canvas"); page.wait_for_timeout(800)
    page.click(".s3-room[data-go=builder]"); page.wait_for_timeout(1200)
    check("clicking the Builder card opens the Builder page", page.url.endswith("#/builder"), page.url)
    check("Builder page shows its log", page.locator(".log li").count() > 0)
    page.click("text=Office"); page.wait_for_timeout(800)
    check("the bottom link goes back to the office", page.url.endswith("#/"), page.url)

    # --- sidebar: story, list, copy ---
    page.wait_for_selector(".story")
    check("sidebar opens on the story", page.locator(".story .ch").count() >= 5)
    page.click("[data-mode=list]"); page.wait_for_timeout(400)
    n_tasks = page.locator(".task").count()
    check("list tab shows tasks", n_tasks > 0, f"{n_tasks} tasks")
    page.click("[data-filter=doing]"); page.wait_for_timeout(300)
    pills = page.locator(".task .pill").all_inner_texts()
    check("the 'doing' filter only shows doing tasks", len(pills) > 0 and all(t.lower() == "doing" for t in pills), str(pills))
    page.click("[data-mode=story]"); page.wait_for_timeout(300)
    page.click("#copyCmd")
    try:  # the clipboard answer can take a moment; wait for the button to report what happened
        page.wait_for_function("document.querySelector('#copyCmd').textContent !== 'Copy command'", timeout=2000)
    except Exception:
        pass
    label = page.inner_text("#copyCmd")
    check("copy button confirms", label in ("Copied", "Select it and copy"), label)

    # --- the full story page ---
    page.click("text=Open the full story"); page.wait_for_timeout(800)
    steps = page.locator(".story.full .steps li").count()
    sites = page.locator(".story.full .site").count()
    check("full story lists every step", steps >= 15, f"{steps} steps")
    check("full story lists the websites used", sites >= 3, f"{sites} sites")
    vague = page.locator(".steps .word", has_text="did").count()
    check("steps get specific labels", vague <= 2, f"{vague} vague 'did' labels")
    page.screenshot(path=os.path.join(SHOTS, "test-story.png"), full_page=True)

    # --- phone width ---
    m = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    m.goto(BASE + "/#/"); m.wait_for_load_state("networkidle"); m.wait_for_timeout(1500)
    overflow = m.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    check("no sideways scrolling on a phone", overflow <= 1, f"overflow {overflow}px")
    m.screenshot(path=os.path.join(SHOTS, "test-phone.png"))
    m.goto(BASE + "/#/analyst"); m.wait_for_timeout(1500)
    check("team page works on a phone", m.locator("#stage3d canvas").count() == 1)

    check("no JavaScript errors", not errors, "; ".join(errors[:3]))
    browser.close()

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)

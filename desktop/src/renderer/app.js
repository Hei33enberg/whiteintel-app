// Renderer — uses ONLY window.whiteintelDesktop (preload). No network, no node.
const wi = window.whiteintelDesktop;
if (!wi) {
  document.body.innerHTML = "<h1 style='padding:40px;font-family:system-ui'>Bridge not available — open in WhiteIntel Desktop.</h1>";
}

const $ = (id) => document.getElementById(id);
const state = { cases: [], activeCaseId: null, docs: [], modelsReady: false };

const unwrap = async (p) => { const r = await p; if (!r.ok) throw new Error(r.error); return r.data; };

const fmtMB = (b) => (b / 1024 / 1024).toFixed(1) + " MB";
const fmtGB = (b) => (b / 1024 / 1024 / 1024).toFixed(2) + " GB";
const fmtSize = (b) => (b >= 1_000_000_000 ? fmtGB(b) : fmtMB(b));

// ── First-run setup ─────────────────────────────────────────────────────────
async function ensureSetup() {
  const status = await unwrap(wi.models.status());
  state.modelsReady = status.allReady;
  renderEnginePill(status);
  if (status.allReady) return;

  const overlay = $("setup");
  overlay.hidden = false;
  const list = $("setup-progress");
  list.innerHTML = status.models
    .map(
      (m) => `<div class="prog ${m.ready ? "done" : ""}" data-id="${m.id}">
        <div class="hdr">
          <span class="name">${escapeHtml(m.name)}</span>
          <span class="stat">${m.ready ? "ready" : "queued — ~" + fmtSize(m.minBytes)}</span>
        </div>
        <div class="bar"><span style="width:${m.ready ? 100 : 0}%"></span></div>
      </div>`,
    )
    .join("");

  // Subscribe to streaming progress events from main.
  wi.models.onProgress((p) => {
    const el = list.querySelector(`.prog[data-id="${p.id}"]`);
    if (!el) return;
    const bar = el.querySelector(".bar > span");
    const stat = el.querySelector(".stat");
    if (p.error) {
      el.classList.add("error");
      stat.textContent = `error: ${p.error}`;
      return;
    }
    el.classList.remove("error");
    const pct = Math.min(100, Math.max(0, p.pct || 0));
    bar.style.width = pct.toFixed(1) + "%";
    if (p.done) {
      el.classList.add("done");
      stat.textContent = `ready · ${fmtSize(p.received)}`;
    } else {
      stat.textContent = `${pct.toFixed(1)}% · ${fmtSize(p.received)} / ${fmtSize(p.total)} · ${p.mbps.toFixed(1)} MB/s`;
    }
  });

  await new Promise((resolve) => {
    $("start-download").addEventListener("click", async () => {
      $("start-download").disabled = true;
      $("start-download").textContent = "Downloading…";
      $("cancel-download").hidden = false;
      const hint = $("setup-hint");
      hint.textContent = "Streaming from huggingface.co. Resume on reconnect is automatic.";
      try {
        await unwrap(wi.models.download());
        hint.textContent = "AI engine ready.";
        hint.classList.add("ok");
        state.modelsReady = true;
        renderEnginePill({ allReady: true, models: [] });
        setTimeout(() => { $("setup").hidden = true; resolve(); }, 400);
      } catch (e) {
        hint.textContent = "Failed: " + e.message + " — click Download to retry (it resumes).";
        hint.classList.add("error");
        $("start-download").disabled = false;
        $("start-download").textContent = "Retry download";
        $("cancel-download").hidden = true;
      }
    }, { once: false });

    $("cancel-download").addEventListener("click", async () => {
      await wi.models.cancelDownload();
      $("setup-hint").textContent = "Cancelled. Click Download to resume.";
      $("start-download").disabled = false;
      $("start-download").textContent = "Resume download";
      $("cancel-download").hidden = true;
    });

    $("setup-open-cloud").addEventListener("click", (e) => {
      e.preventDefault();
      wi.shell.openExternal("https://whiteintel.dev");
    });
  });
}

function renderEnginePill(status) {
  const pill = $("engine-pill");
  if (status.allReady) {
    pill.textContent = "Engine: local · ready";
    pill.classList.remove("bad", "warn");
    pill.classList.add("ok");
    pill.title = "Chat + embedding models loaded from this machine. No network egress for AI.";
  } else {
    pill.textContent = "Engine: setup required";
    pill.classList.remove("ok");
    pill.classList.add("warn");
  }
}

// ── Cases ───────────────────────────────────────────────────────────────────
async function refreshCases() {
  state.cases = await unwrap(wi.cases.list());
  const ul = $("cases");
  ul.innerHTML = state.cases.length
    ? state.cases.map((c) => `<li data-id="${c.id}" class="${c.id === state.activeCaseId ? "active" : ""}">
        <span class="name">${escapeHtml(c.name)}</span>
        <span class="count">${c.doc_count} doc${c.doc_count === 1 ? "" : "s"}</span>
      </li>`).join("")
    : `<li style="color:var(--ink-soft);font-style:italic;padding:14px;">No cases yet — click + New</li>`;
  ul.querySelectorAll("li[data-id]").forEach((el) => el.addEventListener("click", () => selectCase(el.dataset.id)));
}

async function newCase() {
  const name = prompt("Case name (e.g. 'Project Marlin', 'Acme M&A diligence'):");
  if (!name || !name.trim()) return;
  const c = await unwrap(wi.cases.create(name.trim()));
  await refreshCases();
  selectCase(c.id);
}

async function deleteCase() {
  if (!state.activeCaseId) return;
  const c = state.cases.find((x) => x.id === state.activeCaseId);
  if (!c) return;
  if (!confirm(`Delete case "${c.name}" and all its documents? This cannot be undone.`)) return;
  await unwrap(wi.cases.remove(state.activeCaseId));
  state.activeCaseId = null;
  $("workspace").hidden = true;
  $("empty").style.display = "";
  await refreshCases();
}

async function selectCase(id) {
  state.activeCaseId = id;
  const c = state.cases.find((x) => x.id === id);
  if (!c) return;
  $("empty").style.display = "none";
  $("workspace").hidden = false;
  $("case-name").textContent = c.name;
  $("case-meta").textContent = `created ${new Date(c.created_at + "Z").toLocaleString()}`;
  $("answer").textContent = "";
  $("hits").innerHTML = "";
  await refreshCases();
  await refreshDocs();
}

// ── Documents ───────────────────────────────────────────────────────────────
async function refreshDocs() {
  if (!state.activeCaseId) return;
  state.docs = await unwrap(wi.docs.list(state.activeCaseId));
  const ul = $("docs");
  ul.innerHTML = state.docs.length
    ? state.docs.map((d) => `<li>
        <div>
          <div class="name">${escapeHtml(d.name)}</div>
          <div class="meta">${d.chunk_count} chunks${d.pages ? ` · ${d.pages} pages` : ""} · ${new Date(d.created_at + "Z").toLocaleDateString()}</div>
        </div>
      </li>`).join("")
    : `<li class="empty-row">No documents — add a PDF / TXT / MD to start.</li>`;
}

async function addDocs() {
  if (!state.activeCaseId) return;
  const paths = await unwrap(wi.files.pick());
  if (!paths.length) return;
  const hint = $("ingest-hint");
  hint.hidden = false;
  hint.classList.remove("error", "ok");
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    const name = p.split(/[\\/]/).pop();
    hint.textContent = `Ingesting ${i + 1}/${paths.length}: ${name} (chunking + embedding locally…)`;
    try {
      const r = await unwrap(wi.docs.ingest(state.activeCaseId, p));
      hint.textContent = `Ingested ${name} — ${r.chunks} chunks${r.pages ? `, ${r.pages} pages` : ""}.`;
      hint.classList.add("ok");
    } catch (e) {
      hint.textContent = `Failed on ${name}: ${e.message}`;
      hint.classList.add("error");
      break;
    }
    await refreshDocs();
    await refreshCases();
  }
}

// ── Streaming Q&A ───────────────────────────────────────────────────────────
let chatActive = false;
wi?.chat?.onToken((t) => {
  if (!chatActive) return;
  const a = $("answer");
  // Trim trailing caret, append token, reapply caret
  const caret = a.querySelector(".caret");
  if (caret) caret.remove();
  a.appendChild(document.createTextNode(t));
  const c = document.createElement("span");
  c.className = "caret";
  a.appendChild(c);
});

wi?.chat?.onDone((r) => {
  chatActive = false;
  const a = $("answer");
  const caret = a.querySelector(".caret");
  if (caret) caret.remove();
  // Replace with normalized final text (preserves whitespace + dedups any drift)
  a.textContent = r.answer || "(no answer)";
  $("hits").innerHTML = r.hits
    .map((h, i) => `<div class="hit">
        <div class="h"><span><span class="badge">${i + 1}</span> ${escapeHtml(h.doc_name)}</span><span>dist ${h.distance.toFixed(3)}</span></div>
        <div class="t">${escapeHtml(h.text.slice(0, 360))}${h.text.length > 360 ? "…" : ""}</div>
      </div>`).join("");
  $("ask-btn").disabled = false;
  $("ask-btn").textContent = "Ask";
});

async function ask(ev) {
  ev.preventDefault();
  if (!state.activeCaseId) return;
  if (!state.modelsReady) { alert("AI engine not ready — finish the first-run setup."); return; }
  const q = $("q").value.trim();
  if (!q) return;
  const btn = $("ask-btn");
  btn.disabled = true;
  btn.textContent = "Thinking…";
  const answer = $("answer");
  answer.textContent = "";
  $("hits").innerHTML = "";
  // Insert blinking caret to show streaming has started
  const caret = document.createElement("span");
  caret.className = "caret";
  answer.appendChild(caret);
  chatActive = true;
  try {
    await unwrap(wi.chat.ask(state.activeCaseId, q));
  } catch (e) {
    chatActive = false;
    answer.textContent = "Error: " + e.message;
    btn.disabled = false;
    btn.textContent = "Ask";
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ── Wire up ─────────────────────────────────────────────────────────────────
$("new-case").addEventListener("click", newCase);
$("add-docs").addEventListener("click", addDocs);
$("delete-case").addEventListener("click", deleteCase);
$("ask-form").addEventListener("submit", ask);
$("open-cloud").addEventListener("click", (e) => { e.preventDefault(); wi.shell.openExternal("https://whiteintel.dev"); });

(async function init() {
  await ensureSetup();
  await refreshCases();
})();

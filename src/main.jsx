import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Dumbbell,
  CalendarDays,
  Users,
  BookOpen,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Check,
  Play,
  Lock,
  Plus,
  LogOut,
  Flame,
  Clock,
  Download,
  Upload,
  X,
  Mail,
  CheckCircle2,
  Palette,
} from "lucide-react";
import initialPlan from "../plans/foundation-v5.json";
import { latestPlanVersions } from "../shared/plans.js";
import { themes, getTheme } from "../shared/themes.js";
import { applyTheme, readThemeId, rememberTheme } from "./theme.js";
import {
  makeEntry,
  groupExercises,
  getSetLinking,
  editSet,
  setSameForAll,
} from "../shared/workouts.js";
import "./style.css";
import { InstallApp } from "./InstallApp.jsx";
import { api } from "./api.js";
const key = (p) => `${p.id}@${p.version}`;
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const add = (s, n) => {
  const d = new Date(s + "T12:00:00");
  d.setDate(d.getDate() + n);
  return iso(d);
};
const monday = (s) => {
  const d = new Date(s + "T12:00:00");
  return add(s, -((d.getDay() + 6) % 7));
};
const dateText = (s, options) =>
  new Date(s + "T12:00:00").toLocaleDateString("en-US", options);
function selectInputContents(event) {
  const input = event.target;
  if (
    input instanceof HTMLInputElement &&
    ["text", "email", "number", "search", "tel", "url", "password"].includes(
      input.type,
    )
  ) {
    input.select();
  }
}
function App() {
  const [today, setToday] = useState(iso(new Date())),
    [selected, setSelected] = useState(iso(new Date())),
    [week, setWeek] = useState(monday(iso(new Date()))),
    [tab, setTab] = useState("Today"),
    [state, setState] = useState(null),
    [status, setStatus] = useState(null),
    [modal, setModal] = useState(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [previewLogs, setPreviewLogs] = useState([]),
    [history, setHistory] = useState({ context: "", entries: {} }),
    [historyError, setHistoryError] = useState(""),
    [previewTheme, setPreviewTheme] = useState(
      () => getTheme(readThemeId()).id,
    );
  const loadSequence = useRef(0);
  const currentWeek = useRef(week);
  currentWeek.current = week;
  const preview = !state;
  const data = state ?? {
    me: { id: 1, name: "Mike", role: "owner" },
    members: [
      { id: 1, name: "Mike", role: "owner", joined: true },
      { id: 2, name: "Jason", role: "member", joined: false },
    ],
    plans: [initialPlan],
    blocks: [
      {
        id: 1,
        plan_key: key(initialPlan),
        start: monday(today),
        end: add(monday(today), 55),
        weeks: 8,
      },
    ],
    logs: previewLogs,
  };
  const currentPlans = latestPlanVersions(data.plans);
  const block = data.blocks.find(
      (b) => b.start <= selected && b.end >= selected,
    ),
    plan =
      data.plans.find((p) => key(p) === block?.plan_key) ?? currentPlans[0],
    day =
      block &&
      plan.days.find(
        (d) => d.weekday === new Date(selected + "T12:00:00").getDay(),
      ),
    log = data.logs.find(
      (l) => l.member_id === data.me.id && l.date === selected,
    );
  const [draft, setDraft] = useState({}),
    [dirty, setDirty] = useState(false);
  const theme = getTheme(state?.me.theme ?? previewTheme);
  useEffect(() => {
    applyTheme(theme);
    rememberTheme(theme.id);
    setPreviewTheme(theme.id);
  }, [theme.id]);
  useEffect(() => {
    setDraft(log?.body ?? {});
    setDirty(false);
  }, [selected, log, data.me.id, preview]);
  const historyContext = `${data.me.id}:${selected}:${preview}`;
  useEffect(() => {
    let active = true;
    setHistoryError("");
    if (preview) {
      const entries = {};
      for (const row of [...previewLogs]
        .filter((row) => row.date < selected)
        .sort((a, b) => b.date.localeCompare(a.date))) {
        for (const entry of Object.values(row.body)) {
          if (
            entry.done &&
            !entries[entry.variant] &&
            entry.sets.some((set) => set.weight !== null || set.reps !== null)
          ) {
            entries[entry.variant] = { date: row.date, sets: entry.sets };
          }
        }
      }
      setHistory({ context: historyContext, entries });
    } else {
      api(`/history?before=${selected}`)
        .then((result) => {
          if (active)
            setHistory({ context: historyContext, entries: result.history });
        })
        .catch((error) => {
          if (active) {
            setHistory({ context: historyContext, entries: {} });
            setHistoryError(
              "Previous sets could not be loaded. You can still enter them manually.",
            );
          }
        });
    }
    return () => {
      active = false;
    };
  }, [
    selected,
    state?.me.id,
    state?.logs,
    state?.blocks,
    preview,
    previewLogs,
  ]);
  const previous = history.context === historyContext ? history.entries : {};
  async function load() {
    const sequence = ++loadSequence.current;
    try {
      const result = await api("/state?week=" + currentWeek.current);
      if (sequence === loadSequence.current) setState(result);
    } catch (e) {
      if (sequence !== loadSequence.current) return;
      if (e.status === 401) setState(null);
      else setError(e.message);
    }
  }
  useEffect(() => {
    api("/status")
      .then((s) => {
        setStatus(s);
        setToday(s.today);
        setSelected(s.today);
        setWeek(monday(s.today));
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
  }, [week]);
  async function act(fn) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (e.status === 401) {
        loadSequence.current++;
        setState(null);
        setModal("signin");
      }
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function navigate(date) {
    if (
      dirty &&
      !window.confirm("You have unsaved set details. Leave without saving?")
    )
      return;
    setSelected(date);
    setWeek(monday(date));
  }
  function entry(e) {
    return draft[e.id] ?? log?.body[e.id] ?? makeEntry(e, previous[e.id]);
  }
  const currentEntries = Object.fromEntries(
    (day?.exercises ?? []).map((exercise) => [exercise.id, entry(exercise)]),
  );
  function update(e, value) {
    setDraft((d) => ({ ...d, [e.id]: value }));
    setDirty(true);
  }
  async function persist(entries, completed = false) {
    if (preview) {
      setPreviewLogs((logs) => [
        ...logs.filter((l) => l.date !== selected),
        {
          member_id: 1,
          date: selected,
          body: entries,
          completed: Number(completed),
          revision: 1,
        },
      ]);
      setNotice("Preview only. Sign in to save your progress.");
      setDirty(false);
      return;
    }
    await api(
      "/logs/" + selected,
      { entries, completed, revision: log?.revision ?? 0 },
      "PUT",
    );
    await load();
    setNotice(
      completed
        ? "Workout complete. Good work showing up."
        : selected > today
          ? "Planned weights and reps saved to your account."
          : "Progress saved to your account.",
    );
    setDirty(false);
  }
  async function chooseTheme(id) {
    if (preview) {
      setPreviewTheme(id);
      return;
    }
    const result = await api("/preferences", { theme: id }, "PUT");
    setState(
      (current) =>
        current && { ...current, me: { ...current.me, theme: result.theme } },
    );
  }
  const completed = day?.exercises.filter((e) => entry(e).done).length ?? 0;
  const weekLogs = data.logs.filter(
    (l) => l.date >= week && l.date <= add(week, 6),
  );
  const ownCompleted = weekLogs.filter(
    (l) => l.member_id === data.me.id && l.completed,
  ).length;
  const schedule = Array.from({ length: 7 }, (_, i) => add(week, i)).map(
    (date) => {
      const b = data.blocks.find((b) => b.start <= date && b.end >= date);
      const p = data.plans.find((p) => key(p) === b?.plan_key);
      return {
        date,
        day: p?.days.find(
          (d) => d.weekday === new Date(date + "T12:00:00").getDay(),
        ),
      };
    },
  );
  const trainingDays = schedule.filter((s) => s.day);
  const group = (
    <>
      <div className="section-title">
        <h2>Your training group</h2>
        <span className="pill">
          <Lock size={12} />
          Invite only
        </span>
      </div>
      {data.members
        .filter((m) => m.removed_at == null)
        .map((m) => {
          const count = weekLogs.filter(
            (l) => l.member_id === m.id && l.completed,
          ).length;
          return (
            <div className="member" key={m.id}>
              <div
                className={"avatar " + (m.id === data.me.id ? "orange" : "")}
              >
                {m.name.charAt(0)}
              </div>
              <div className="member-info">
                <strong>
                  {m.name} {m.id === data.me.id && <small>You</small>}
                  <small className={m.role === "owner" ? "admin-badge" : ""}>
                    {m.role === "owner" ? "Admin" : "Member"}
                  </small>
                </strong>
                <p>
                  {!m.joined
                    ? "Invitation pending"
                    : `${count} of ${trainingDays.length} workouts this week`}
                </p>
                {tab === "Group" && m.email && (
                  <p className="member-email">{m.email}</p>
                )}
                <div className="mini-week">
                  {trainingDays.map((s) => (
                    <span
                      key={s.date}
                      className={
                        weekLogs.some(
                          (l) =>
                            l.member_id === m.id &&
                            l.date === s.date &&
                            l.completed,
                        )
                          ? "done"
                          : ""
                      }
                    >
                      {dateText(s.date, { weekday: "short" })}
                      <i />
                    </span>
                  ))}
                </div>
                {tab === "Group" &&
                  data.me.role === "owner" &&
                  m.role !== "owner" && (
                    <button
                      className="member-action"
                      disabled={busy}
                      onClick={() => {
                        setError("");
                        setModal(
                          preview ? "signin" : { type: "revoke", member: m },
                        );
                      }}
                    >
                      {m.joined ? "Remove member" : "Revoke invitation"}
                    </button>
                  )}
              </div>
            </div>
          );
        })}
      {data.me.role === "owner" && (
        <button
          className="outline full"
          onClick={() => setModal(preview ? "signin" : "invite")}
        >
          <Plus size={17} />
          Invite someone
        </button>
      )}
      {tab === "Group" &&
        data.me.role === "owner" &&
        data.members.some((m) => m.removed_at != null) && (
          <details className="removed-members">
            <summary>Removed members & revoked invitations</summary>
            {data.members
              .filter((m) => m.removed_at != null)
              .map((m) => (
                <div className="removed-member" key={m.id}>
                  <div>
                    <strong>{m.name}</strong>
                    <p className="member-email">{m.email}</p>
                    <small>Access revoked · history retained</small>
                  </div>
                  <button
                    className="outline"
                    disabled={busy}
                    onClick={() => {
                      setError("");
                      setModal({ type: "invite", member: m });
                    }}
                  >
                    Invite again
                  </button>
                </div>
              ))}
          </details>
        )}
      {tab === "Group" && (
        <div className="permissions-note">
          <strong>
            {data.me.role === "owner"
              ? "You’re the admin."
              : "Your member access"}
          </strong>
          <p>
            {data.me.role === "owner"
              ? "Only you can invite or remove people, import plans, and schedule training blocks. Your admin account cannot be removed."
              : "Log your own workouts, view the plan, and follow the group’s completion. Mike manages invitations and plans. Your detailed set logs are visible to you and Mike."}
          </p>
        </div>
      )}
      <p className="muted small">A little accountability goes a long way.</p>
    </>
  );
  return (
    <div
      onFocusCapture={selectInputContents}
      onClickCapture={selectInputContents}
    >
      <header>
        <a className="brand" href={import.meta.env.BASE_URL}>
          <Dumbbell />
          <span>
            Train<span className="brand-dot">.</span>
          </span>
        </a>
        <nav className="desktop-nav">
          {["Today", "Week", "Group", "Plan"].map((t) => (
            <button
              key={t}
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <button
            className="theme-trigger"
            aria-label="Choose color theme"
            onClick={() => {
              setError("");
              setModal("themes");
            }}
          >
            <Palette size={19} />
            <span>Theme</span>
          </button>
          <button
            className="account"
            onClick={() =>
              preview
                ? setModal("signin")
                : act(async () => {
                    await api("/auth/logout", {});
                    loadSequence.current++;
                    setState(null);
                  })
            }
          >
            {preview ? (
              <>
                <Lock size={15} />
                Sign in
              </>
            ) : (
              <>
                {data.me.name}
                <LogOut size={15} />
              </>
            )}
          </button>
        </div>
      </header>
      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">STRENGTH. CONSISTENCY. FELLOWSHIP.</p>
            <h1>
              iron sharpens iron<span>.</span>
            </h1>
            <blockquote className="scripture">
              “Iron sharpens iron, and one man sharpens another.”
            </blockquote>
            <a
              className="verse"
              href="https://www.esv.org/verses/Proverbs+27:17/"
              target="_blank"
              rel="noreferrer"
            >
              Proverbs 27:17 · ESV
            </a>
          </div>
          <div className="hero-tools">
            <div className="schedule">
              <Clock size={16} />
              {plan.schedule}
            </div>
            <InstallApp />
          </div>
        </section>
        {preview && (
          <div className="preview-banner">
            <span>
              <b>Take a look around.</b> This is an interactive preview. Sign in
              to save your workouts.
            </span>
            <button onClick={() => setModal("signin")}>
              Let’s get started <ArrowUpRight size={16} />
            </button>
          </div>
        )}
        {error && (
          <div className="alert error" role="alert">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="alert" role="status">
            {notice}
          </div>
        )}
        <div className="content-grid">
          <section className="primary">
            {(tab === "Today" || tab === "Week") && (
              <>
                <div className="week-heading">
                  <div>
                    <p className="eyebrow">MAKE TIME FOR YOURSELF</p>
                    <h2>
                      {dateText(week, { month: "long", day: "numeric" })} –{" "}
                      {dateText(add(week, 6), {
                        day: "numeric",
                        month:
                          week.slice(5, 7) !== add(week, 6).slice(5, 7)
                            ? "short"
                            : undefined,
                      })}
                    </h2>
                  </div>
                  <div className="arrows">
                    <button
                      aria-label="Previous week"
                      onClick={() => navigate(add(selected, -7))}
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button
                      aria-label="Current week"
                      onClick={() => navigate(today)}
                    >
                      Today
                    </button>
                    <button
                      aria-label="Next week"
                      onClick={() => navigate(add(selected, 7))}
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </div>
                <div className="week-strip">
                  {schedule.map((s) => (
                    <button
                      key={s.date}
                      onClick={() => {
                        navigate(s.date);
                        setTab("Today");
                      }}
                      aria-pressed={selected === s.date}
                      className={selected === s.date ? "selected" : ""}
                    >
                      <span>{dateText(s.date, { weekday: "short" })}</span>
                      <b>{dateText(s.date, { day: "numeric" })}</b>
                      {weekLogs.some(
                        (l) =>
                          l.member_id === data.me.id &&
                          l.date === s.date &&
                          l.completed,
                      ) ? (
                        <Check size={12} />
                      ) : (
                        <i className={s.day ? "training" : ""} />
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
            {tab === "Today" &&
              (day ? (
                <>
                  <div className="workout-heading">
                    <div>
                      <p className="eyebrow">
                        {day.name.toUpperCase()} · {day.exercises.length}{" "}
                        EXERCISES
                      </p>
                      <h2>{day.focus}</h2>
                    </div>
                    <span className="completion">
                      {completed}
                      <small> / {day.exercises.length}</small>
                    </span>
                  </div>
                  <div className="progress">
                    <i
                      style={{
                        width: (100 * completed) / day.exercises.length + "%",
                      }}
                    />
                  </div>
                  <div className="exercise-list">
                    {historyError && (
                      <p className="small muted" role="status">
                        {historyError}
                      </p>
                    )}
                    {groupExercises(day.exercises).map(
                      ({ name, exercises }) => (
                        <section
                          className="exercise-group"
                          key={name}
                          aria-label={name}
                        >
                          <div className="exercise-group-heading">
                            <h3>{name}</h3>
                            <span>
                              {exercises.filter((e) => entry(e).done).length} /{" "}
                              {exercises.length} complete
                            </span>
                          </div>
                          {exercises.map((e) => {
                            const ent = entry(e),
                              linking = getSetLinking(ent),
                              variant =
                                [e, ...e.substitutions].find(
                                  (v) => v.id === ent.variant,
                                ) ?? e;
                            return (
                              <article
                                className={
                                  "exercise " + (ent.done ? "checked" : "")
                                }
                                key={e.id}
                              >
                                <div className="exercise-top">
                                  <button
                                    className="checkbox"
                                    aria-label={
                                      "Mark " +
                                      e.name +
                                      (ent.done ? " incomplete" : " complete")
                                    }
                                    role="checkbox"
                                    aria-checked={ent.done}
                                    disabled={busy || selected > today}
                                    onClick={() =>
                                      act(async () => {
                                        const next = {
                                          ...currentEntries,
                                          [e.id]: { ...ent, done: !ent.done },
                                        };
                                        setDraft(next);
                                        setDirty(true);
                                        await persist(next, false);
                                      })
                                    }
                                  >
                                    {ent.done && <Check size={20} />}
                                  </button>
                                  <div className="exercise-name">
                                    <h3>{variant.name}</h3>
                                    <p>
                                      {variant.sets} sets <span>×</span>{" "}
                                      {variant.reps} reps{" "}
                                      {day.exercises.indexOf(e) < 3 && (
                                        <span className="priority">
                                          PRIORITY
                                        </span>
                                      )}
                                    </p>
                                  </div>
                                </div>
                                <div className="exercise-bottom">
                                  <a
                                    href={
                                      variant.demo.url +
                                      (variant.demo.startSeconds
                                        ? `&t=${variant.demo.startSeconds}s`
                                        : "")
                                    }
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    <Play size={14} />
                                    <span>Watch {variant.demo.instructor}</span>
                                    <ArrowUpRight size={13} />
                                  </a>
                                  {variant.demo.caption && (
                                    <p className="demo-caption">
                                      {variant.demo.caption}
                                    </p>
                                  )}
                                  <details>
                                    <summary>
                                      Log sets <Plus size={13} />
                                    </summary>
                                    {previous[variant.id] && (
                                      <div className="previous-sets">
                                        <p>
                                          Last completed ·{" "}
                                          {dateText(previous[variant.id].date, {
                                            month: "short",
                                            day: "numeric",
                                          })}
                                          <span>
                                            {previous[variant.id].sets
                                              .map(
                                                (set) =>
                                                  `${set.weight ?? "—"} lb × ${set.reps ?? "—"}`,
                                              )
                                              .join(" · ")}
                                          </span>
                                        </p>
                                        <button
                                          className="text-button"
                                          disabled={busy}
                                          onClick={() =>
                                            update(
                                              e,
                                              makeEntry(
                                                variant,
                                                previous[variant.id],
                                              ),
                                            )
                                          }
                                        >
                                          Use last time
                                        </button>
                                      </div>
                                    )}
                                    {!draft[e.id] &&
                                      !log?.body[e.id] &&
                                      previous[variant.id] && (
                                        <p className="prefill-note">
                                          Prefilled from last time. Adjust as
                                          needed, then check off when finished.
                                        </p>
                                      )}
                                    {ent.sets.length > 1 && (
                                      <div className="set-link-control">
                                        <button
                                          className="set-link-switch"
                                          role="switch"
                                          aria-checked={linking.enabled}
                                          aria-label={`${variant.name}: Same for all sets`}
                                          aria-describedby={`set-link-note-${e.id}`}
                                          disabled={busy}
                                          onClick={() =>
                                            update(
                                              e,
                                              setSameForAll(
                                                ent,
                                                !linking.enabled,
                                              ),
                                            )
                                          }
                                        >
                                          <span>Same for all sets</span>
                                          <span
                                            className="switch-track"
                                            aria-hidden="true"
                                          >
                                            <i />
                                          </span>
                                        </button>
                                        <p id={`set-link-note-${e.id}`}>
                                          {linking.enabled
                                            ? "Set 1 fills untouched sets. Edit a later set to keep it separate."
                                            : "Enter each set separately. Turn on to fill untouched sets from set 1."}
                                        </p>
                                      </div>
                                    )}
                                    <div className="set-grid">
                                      <span>SET</span>
                                      <span>WEIGHT · LB</span>
                                      <span>REPS</span>
                                      {ent.sets.map((s, i) => (
                                        <React.Fragment key={i}>
                                          <span className="set-number">
                                            {i + 1}
                                            {linking.independent[i] && (
                                              <small>Custom</small>
                                            )}
                                          </span>
                                          <input
                                            aria-label={`${variant.name} set ${i + 1} weight`}
                                            inputMode="decimal"
                                            type="number"
                                            min="0"
                                            max="3000"
                                            step="0.5"
                                            value={s.weight ?? ""}
                                            disabled={busy}
                                            onChange={(ev) =>
                                              update(
                                                e,
                                                editSet(
                                                  ent,
                                                  i,
                                                  "weight",
                                                  ev.target.value === ""
                                                    ? null
                                                    : Number(ev.target.value),
                                                ),
                                              )
                                            }
                                          />
                                          <input
                                            aria-label={`${variant.name} set ${i + 1} reps`}
                                            inputMode="numeric"
                                            type="number"
                                            min="0"
                                            max="1000"
                                            value={s.reps ?? ""}
                                            disabled={busy}
                                            onChange={(ev) =>
                                              update(
                                                e,
                                                editSet(
                                                  ent,
                                                  i,
                                                  "reps",
                                                  ev.target.value === ""
                                                    ? null
                                                    : Number(ev.target.value),
                                                ),
                                              )
                                            }
                                          />
                                        </React.Fragment>
                                      ))}
                                    </div>
                                    {e.substitutions.length > 0 && (
                                      <label>
                                        Exercise variation
                                        <select
                                          value={ent.variant}
                                          disabled={busy}
                                          onChange={(ev) => {
                                            const v = [
                                              e,
                                              ...e.substitutions,
                                            ].find(
                                              (v) => v.id === ev.target.value,
                                            );
                                            update(
                                              e,
                                              makeEntry(v, previous[v.id]),
                                            );
                                          }}
                                        >
                                          {[e, ...e.substitutions].map((v) => (
                                            <option value={v.id} key={v.id}>
                                              {v.name}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                    )}
                                  </details>
                                </div>
                              </article>
                            );
                          })}
                        </section>
                      ),
                    )}
                  </div>
                  <div className="save-actions">
                    {dirty && (
                      <button
                        className="outline"
                        disabled={busy}
                        onClick={() =>
                          act(() =>
                            persist(
                              currentEntries,
                              Boolean(log?.completed) &&
                                completed === day.exercises.length,
                            ),
                          )
                        }
                      >
                        {selected > today
                          ? "Save planned weights"
                          : "Save set details"}
                      </button>
                    )}
                    <button
                      className="solid"
                      disabled={
                        busy ||
                        completed < day.exercises.length ||
                        selected > today
                      }
                      onClick={() => act(() => persist(currentEntries, true))}
                    >
                      <CheckCircle2 size={18} />
                      {log?.completed ? "Workout complete" : "Complete workout"}
                    </button>
                  </div>
                  <p className="small muted centered">
                    {selected > today
                      ? "Plan your weights and reps now. Checkoffs open on the scheduled day."
                      : preview
                        ? "Preview checkoffs are temporary."
                        : "Your checkoffs are saved to your account."}
                  </p>
                  <div className="coach-note">
                    <Flame size={20} />
                    <div>
                      <strong>Consistency over intensity.</strong>
                      <p>
                        Exercises marked PRIORITY come first if time is short.
                        Alternate sets with your partner and leave 2–3 reps in
                        reserve.
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="card recovery">
                  <Dumbbell size={38} />
                  <p className="eyebrow">
                    {block
                      ? "RECOVERY IS PART OF THE PLAN"
                      : "YOUR NEXT CHAPTER"}
                  </p>
                  <h2>
                    {block
                      ? "Take a breath. Come back stronger."
                      : "Let’s set your training block."}
                  </h2>
                  <p>
                    {block
                      ? "No workout scheduled today. Choose a training day above to see your next session."
                      : "Choose a start date and a plan to begin tracking together."}
                  </p>
                  <button
                    className="solid"
                    onClick={() =>
                      block
                        ? navigate(
                            schedule.find((s) => s.day && s.date >= selected)
                              ?.date ??
                              trainingDays[0]?.date ??
                              add(selected, 1),
                          )
                        : setTab("Plan")
                    }
                  >
                    {block ? "View a training day" : "Choose your plan"}
                    <ArrowUpRight size={16} />
                  </button>
                </div>
              ))}
            {tab === "Week" && (
              <>
                <div className="workout-heading">
                  <h2>Your week, one session at a time.</h2>
                </div>
                {trainingDays.length === 0 && (
                  <p>No sessions scheduled for this week.</p>
                )}
                {trainingDays.map((s) => {
                  const l = weekLogs.find(
                    (l) => l.member_id === data.me.id && l.date === s.date,
                  );
                  return (
                    <button
                      className="card week-session full"
                      key={s.date}
                      onClick={() => {
                        navigate(s.date);
                        setTab("Today");
                      }}
                    >
                      <div>
                        <span className="eyebrow">{s.day.name}</span>
                        <h3>{s.day.focus}</h3>
                        <p>
                          {l?.completed
                            ? "Completed"
                            : l
                              ? `${Object.values(l.body).filter((e) => e.done).length} exercises checked off`
                              : s.date > today
                                ? "Upcoming"
                                : "Not logged"}
                        </p>
                      </div>
                      <ChevronRight />
                    </button>
                  );
                })}
                <p className="muted">
                  Use the week arrows to revisit your history. Every workout
                  keeps its original plan version.
                </p>
              </>
            )}
            {tab === "Group" && <div className="card group-main">{group}</div>}
            {tab === "Plan" && (
              <>
                <p className="eyebrow">BUILT FOR THE LONG RUN</p>
                <h2 className="page-title">A plan you can grow with.</h2>
                {currentPlans.map((p) => (
                  <article className="card plan-card" key={key(p)}>
                    <span className="pill">{p.weeks} WEEKS</span>
                    <h2>{p.name}</h2>
                    <p>{p.description}</p>
                    {p.days.map((d) => (
                      <details key={d.id}>
                        <summary>
                          {d.name}
                          <span>{d.focus}</span>
                          <Plus size={16} />
                        </summary>
                        {groupExercises(d.exercises).map(
                          ({ name, exercises }) => (
                            <div className="plan-exercise-group" key={name}>
                              <h4>{name}</h4>
                              <ol>
                                {exercises.map((e) => (
                                  <li key={e.id}>
                                    {e.name}
                                    <small>
                                      {e.sets} × {e.reps}
                                    </small>
                                  </li>
                                ))}
                              </ol>
                            </div>
                          ),
                        )}
                      </details>
                    ))}
                    <div className="plan-actions">
                      <button
                        className="outline"
                        onClick={() => {
                          const url = URL.createObjectURL(
                            new Blob([JSON.stringify(p, null, 2)], {
                              type: "application/json",
                            }),
                          );
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = key(p) + ".json";
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        <Download size={16} />
                        Export JSON
                      </button>
                      {data.me.role === "owner" && (
                        <button
                          className="solid"
                          onClick={() =>
                            setModal(
                              preview ? "signin" : { type: "block", plan: p },
                            )
                          }
                        >
                          Schedule plan
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                {data.me.role === "owner" && (
                  <label className="upload">
                    <Upload size={18} />
                    Import a new plan version
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={(ev) => {
                        const file = ev.target.files[0];
                        if (!file) return;
                        if (preview) {
                          setModal("signin");
                          return;
                        }
                        act(async () => {
                          await api("/plans", JSON.parse(await file.text()));
                          await load();
                          setNotice(
                            "Plan imported. Schedule a block when you are ready.",
                          );
                        });
                        ev.target.value = "";
                      }}
                    />
                  </label>
                )}
                <div className="card">
                  <h3>Training blocks</h3>
                  {data.blocks.length ? (
                    data.blocks.map((b) => (
                      <p key={b.id}>
                        {b.start} → {b.end}
                        <br />
                        <small className="muted">
                          {b.plan_key} · {b.weeks} weeks
                        </small>
                      </p>
                    ))
                  ) : (
                    <p className="muted">No block scheduled yet.</p>
                  )}
                </div>
                <div className="card">
                  <h3>Keep these in mind</h3>
                  {plan.notes.map((n) => (
                    <p className="muted" key={n}>
                      {n === "The first three exercises are the priority."
                        ? "Exercises marked PRIORITY come first if time is short."
                        : n}
                    </p>
                  ))}
                </div>
              </>
            )}
          </section>
          <aside>
            <div className="card">{group}</div>
            <div className="card goal">
              <div>
                <p className="eyebrow">THIS WEEK’S GOAL</p>
                <h2>
                  {trainingDays.length} sessions<span>.</span>
                </h2>
                <p>{ownCompleted} complete. Keep showing up.</p>
              </div>
              <div
                className="goal-ring"
                style={{
                  "--percent": `${trainingDays.length ? (ownCompleted / trainingDays.length) * 100 : 0}%`,
                }}
              >
                <b>
                  {ownCompleted}
                  <small>/{trainingDays.length}</small>
                </b>
              </div>
            </div>
            <div className="quiet-card">
              <Lock size={19} />
              <div>
                <strong>Your account, your progress.</strong>
                <p>Train together. Everyone edits their own workouts.</p>
              </div>
            </div>
            <div className="block-label">
              <span>THE TRAINING RHYTHM</span>
              <b>Lift. Recover. Repeat.</b>
              <div className="rhythm">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
          </aside>
        </div>
        <footer>
          Small steps. Shared strength.
          <span>Train · PROVERBS 27:17</span>
        </footer>
      </main>
      <nav className="mobile-nav">
        {[
          [Dumbbell, "Today"],
          [CalendarDays, "Week"],
          [Users, "Group"],
          [BookOpen, "Plan"],
        ].map(([Icon, t]) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            <Icon size={21} />
            {t}
          </button>
        ))}
      </nav>
      {modal && (
        <div className="modal-backdrop">
          <section
            className={"modal " + (modal === "themes" ? "theme-modal" : "")}
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "signin"
                ? "Sign in"
                : modal === "themes"
                  ? "Choose color theme"
                  : "Manage training group"
            }
          >
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button
              className="close"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X />
            </button>
            {modal === "signin" ? (
              <SignIn
                status={status}
                onDone={async () => {
                  await load();
                  setModal(null);
                  setStatus(await api("/status"));
                }}
              />
            ) : modal === "themes" ? (
              <div>
                <p className="eyebrow">MAKE IT YOURS</p>
                <h2>Your colors. Your choice.</h2>
                <p className="muted">
                  {preview
                    ? "Try all ten themes. Your preview choice stays on this device."
                    : "Saved to your account. Everyone picks their own theme."}
                </p>
                <div className="theme-options">
                  {themes.map((option, index) => (
                    <button
                      key={option.id}
                      className="theme-option"
                      aria-pressed={theme.id === option.id}
                      disabled={busy}
                      onClick={() => act(() => chooseTheme(option.id))}
                    >
                      <span className="theme-swatches" aria-hidden="true">
                        {[
                          option.bg,
                          option.surface,
                          option.accent,
                          option.secondary,
                        ].map((color, index) => (
                          <i key={index} style={{ background: color }} />
                        ))}
                      </span>
                      <span>
                        {index + 1}. {option.name}
                      </span>
                      {theme.id === option.id && <Check size={16} />}
                    </button>
                  ))}
                </div>
                <button className="solid full" onClick={() => setModal(null)}>
                  Done
                </button>
              </div>
            ) : modal.type === "revoke" ? (
              <div>
                <p className="eyebrow">ADMIN · MEMBER ACCESS</p>
                <h2>
                  {modal.member.joined
                    ? `Remove ${modal.member.name}?`
                    : `Revoke ${modal.member.name}’s invitation?`}
                </h2>
                <p className="muted">
                  Their access ends immediately, including existing sign-ins and
                  unused codes. Workout history stays saved. You can invite them
                  again later.
                </p>
                <div className="plan-actions">
                  <button
                    className="outline"
                    disabled={busy}
                    onClick={() => setModal(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="solid"
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        const result = await api(
                          `/members/${modal.member.id}/revoke`,
                          {},
                        );
                        await load();
                        setModal(null);
                        setNotice(result.message);
                      })
                    }
                  >
                    {busy
                      ? "Updating…"
                      : modal.member.joined
                        ? "Remove member"
                        : "Revoke invitation"}
                  </button>
                </div>
              </div>
            ) : modal === "invite" || modal.type === "invite" ? (
              <ActionForm
                title="Better with a friend."
                description="Send an invitation. Only invited email addresses can join your group."
                onSubmit={(values) =>
                  act(async () => {
                    const r = await api("/invites", values);
                    await load();
                    setModal(null);
                    setNotice(r.message);
                  })
                }
                fields={[
                  ["name", "Name", "text", modal.member?.name ?? "Jason"],
                  [
                    "email",
                    "Email address",
                    "email",
                    modal.member?.email ?? "",
                  ],
                ]}
                button="Send invitation"
                busy={busy}
              />
            ) : (
              <ActionForm
                title="Your next training block."
                description="Past workouts stay linked to their original plan. Blocks cannot overlap."
                onSubmit={(values) =>
                  act(async () => {
                    await api("/blocks", {
                      ...values,
                      weeks: Number(values.weeks),
                      planKey: key(modal.plan),
                    });
                    await load();
                    setModal(null);
                    setNotice("Training block scheduled.");
                  })
                }
                fields={[
                  [
                    "start",
                    "Start date",
                    "date",
                    data.blocks.length
                      ? add(data.blocks.at(-1).end, 1)
                      : monday(today),
                  ],
                  ["weeks", "Number of weeks", "number", modal.plan.weeks],
                ]}
                button="Schedule block"
                busy={busy}
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function ActionForm({ title, description, fields, onSubmit, button, busy }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(Object.fromEntries(new FormData(e.currentTarget)));
      }}
    >
      <p className="eyebrow">Train</p>
      <h2>{title}</h2>
      <p className="muted">{description}</p>
      {fields.map(([name, label, type, value]) => (
        <label key={name}>
          {label}
          <input
            autoFocus={name === fields[0][0]}
            name={name}
            type={type}
            defaultValue={value}
            required
            min={type === "number" ? 1 : undefined}
            max={type === "number" ? 52 : undefined}
          />
        </label>
      ))}
      <button disabled={busy} className="solid full">
        {busy ? "Working…" : button}
        <ArrowUpRight size={17} />
      </button>
    </form>
  );
}
function SignIn({ status, onDone }) {
  const [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [sent, setSent] = useState(false),
    [dev, setDev] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [setup, setSetup] = useState(status?.setup);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setBusy(true);
        try {
          if (!sent) {
            if (setup) {
              await api("/setup", { email });
              setSetup(false);
            }
            const r = await api("/auth/send", { email });
            setSent(true);
            setDev(r.developmentCode ?? "");
          } else {
            await api("/auth/verify", { email, code });
            await onDone();
          }
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Mail className="orange-text" size={30} />
      <h2>
        {sent
          ? "Check your inbox."
          : setup
            ? "Welcome, Mike."
            : "Good to see you."}
      </h2>
      <p className="muted">
        {sent
          ? "If this address is invited, a six-digit code is on its way. Enter it below to accept your invitation and sign in."
          : setup
            ? "Set up your owner account, then invite Jason from the Group tab."
            : "Use your invited email address. No password to remember."}
      </p>
      {status?.emailMode === "development" && (
        <p className="dev-note">
          Local development · email delivery is not connected.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <label>
        Email address
        <input
          autoFocus
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={sent}
        />
      </label>
      {sent && (
        <label>
          Verification code
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </label>
      )}
      {dev && (
        <p className="dev-note">
          Development code: <b>{dev}</b> · expires in 10 minutes
        </p>
      )}
      <button className="solid full" disabled={busy}>
        {busy ? "One moment…" : sent ? "Verify & sign in" : "Send me a code"}
        <ArrowUpRight size={17} />
      </button>
      {sent && (
        <button
          className="text-button"
          type="button"
          onClick={() => {
            setSent(false);
            setCode("");
            setDev("");
          }}
        >
          Change email or request a new code
        </button>
      )}
    </form>
  );
}
createRoot(document.getElementById("root")).render(<App />);

import { useCallback, useEffect, useRef, useState } from "react";
import CRDTDocument, { type Item, type Version } from "../utils/crdt";
import "./CRDTDemo.css";

type EditorId = "A" | "B";
type LogKind = "local" | "sync" | "network";
type SyncDirection = "AtoB" | "BtoA" | "both";

type EditorSnapshot = {
    text: string;
    version: Version;
    items: Item[];
};

type ConnectionState = {
    A: boolean;
    B: boolean;
};

type PendingState = {
    aToB: number;
    bToA: number;
};

type LogEntry = {
    id: number;
    time: string;
    kind: LogKind;
    message: string;
};

type TextDelta = {
    start: number;
    deleteCount: number;
    insertText: string;
};

function createEmptySnapshot(): EditorSnapshot {
    return {
        text: "",
        version: {},
        items: [],
    };
}

const AGENT_BY_EDITOR: Record<EditorId, string> = {
    A: "editor-a",
    B: "editor-b",
};

function snapshot(doc: CRDTDocument): EditorSnapshot {
    return {
        text: doc.getText(),
        version: doc.getVersion(),
        items: doc.getItems(),
    };
}

function formatId(id: Item["id"] | null): string {
    if (id == null) return "null";
    return `${id[0]}:${id[1]}`;
}

function formatChar(value: string): string {
    if (value === " ") return "space";
    if (value === "\n") return "\\n";
    if (value === "\t") return "\\t";
    return value;
}

function previewText(value: string): string {
    return value.replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}

function computeTextDelta(prev: string, next: string): TextDelta | null {
    if (prev === next) return null;

    let start = 0;
    while (start < prev.length && start < next.length && prev[start] === next[start]) {
        start++;
    }

    let prevEnd = prev.length - 1;
    let nextEnd = next.length - 1;
    while (prevEnd >= start && nextEnd >= start && prev[prevEnd] === next[nextEnd]) {
        prevEnd--;
        nextEnd--;
    }

    return {
        start,
        deleteCount: Math.max(0, prevEnd - start + 1),
        insertText: next.slice(start, nextEnd + 1),
    };
}

function editorLabel(editor: EditorId): string {
    return editor === "A" ? "Editor A" : "Editor B";
}

export default function CRDTDemo() {
    const docARef = useRef(new CRDTDocument());
    const docBRef = useRef(new CRDTDocument());
    const logCounterRef = useRef(0);
    const seededRef = useRef(false);

    const [editorA, setEditorA] = useState<EditorSnapshot>(createEmptySnapshot);
    const [editorB, setEditorB] = useState<EditorSnapshot>(createEmptySnapshot);
    const [connection, setConnection] = useState<ConnectionState>({ A: true, B: true });
    const [pending, setPending] = useState<PendingState>({ aToB: 0, bToA: 0 });
    const [logs, setLogs] = useState<LogEntry[]>([]);

    const addLog = useCallback((kind: LogKind, message: string) => {
        const nextId = logCounterRef.current + 1;
        logCounterRef.current = nextId;

        setLogs((prev) =>
            [
                {
                    id: nextId,
                    kind,
                    message,
                    time: new Date().toLocaleTimeString(),
                },
                ...prev,
            ].slice(0, 120),
        );
    }, []);

    const refreshSnapshots = useCallback(() => {
        setEditorA(snapshot(docARef.current));
        setEditorB(snapshot(docBRef.current));
    }, []);

    const syncDocs = useCallback(
        (direction: SyncDirection, reason: string) => {
            const beforeA = docARef.current.getText();
            const beforeB = docBRef.current.getText();

            if (direction === "AtoB" || direction === "both") {
                docBRef.current.mergeFrom(docARef.current);
            }
            if (direction === "BtoA" || direction === "both") {
                docARef.current.mergeFrom(docBRef.current);
            }

            const afterA = docARef.current.getText();
            const afterB = docBRef.current.getText();

            if (direction === "AtoB") {
                setPending((prev) => ({ ...prev, aToB: 0 }));
                addLog("sync", `${reason}: A -> B ${beforeB === afterB ? "no-op" : "applied"}.`);
            } else if (direction === "BtoA") {
                setPending((prev) => ({ ...prev, bToA: 0 }));
                addLog("sync", `${reason}: B -> A ${beforeA === afterA ? "no-op" : "applied"}.`);
            } else {
                setPending({ aToB: 0, bToA: 0 });
                addLog("sync", `${reason}: A ${beforeA === afterA ? "unchanged" : "updated"}, B ${beforeB === afterB ? "unchanged" : "updated"}.`);
            }

            refreshSnapshots();
        },
        [addLog, refreshSnapshots],
    );

    const applyEditorChange = useCallback(
        (editor: EditorId, nextText: string) => {
            const sourceDoc = editor === "A" ? docARef.current : docBRef.current;
            const previousText = sourceDoc.getText();
            const delta = computeTextDelta(previousText, nextText);

            if (!delta) return;

            if (delta.deleteCount > 0) {
                sourceDoc.delete(delta.start, delta.deleteCount);
                addLog("local", `${editorLabel(editor)} deleted ${delta.deleteCount} char at ${delta.start}.`);
            }

            if (delta.insertText.length > 0) {
                sourceDoc.insert(AGENT_BY_EDITOR[editor], delta.start, delta.insertText);
                addLog("local", `${editorLabel(editor)} inserted "${previewText(delta.insertText)}" at ${delta.start}.`);
            }

            if (connection.A && connection.B) {
                syncDocs(editor === "A" ? "AtoB" : "BtoA", `Auto merge from ${editorLabel(editor)}`);
                return;
            }

            if (editor === "A") {
                setPending((prev) => ({ ...prev, aToB: prev.aToB + 1 }));
            } else {
                setPending((prev) => ({ ...prev, bToA: prev.bToA + 1 }));
            }

            addLog("network", `${editorLabel(editor)} is isolated. Change is only local until a push happens.`);
            refreshSnapshots();
        },
        [addLog, connection.A, connection.B, refreshSnapshots, syncDocs],
    );

    const toggleIsolation = useCallback(
        (editor: EditorId) => {
            setConnection((prev) => {
                const next = editor === "A" ? { ...prev, A: !prev.A } : { ...prev, B: !prev.B };
                addLog("network", `${editorLabel(editor)} ${next[editor] ? "reconnected to live sync" : "isolated from live sync"}.`);

                if (next.A && next.B && (pending.aToB > 0 || pending.bToA > 0)) {
                    queueMicrotask(() => {
                        syncDocs("both", "Auto catch-up after reconnect");
                    });
                }

                return next;
            });
        },
        [addLog, pending.aToB, pending.bToA, syncDocs],
    );

    const resetDemo = useCallback(() => {
        docARef.current = new CRDTDocument();
        docBRef.current = new CRDTDocument();
        setConnection({ A: true, B: true });
        setPending({ aToB: 0, bToA: 0 });
        logCounterRef.current = 0;
        setLogs([]);
        refreshSnapshots();
        addLog("network", "Demo reset with both editors connected.");
    }, [addLog, refreshSnapshots]);

    useEffect(() => {
        if (seededRef.current) return;
        seededRef.current = true;
        addLog("network", "Both editors are online. Type in any editor to see automatic merges.");
    }, [addLog]);

    const autoMergeOn = connection.A && connection.B;

    return (
        <div className="crdt-demo">
            <header className="crdt-header">
                <p className="eyebrow">CRDT Demo</p>
                <h1>Two Editors With Live Merge</h1>
                <p className="intro">
                    This playground shows each local operation, internal CRDT items, and version vectors. Keep both editors connected for Google Docs
                    style live sync. Isolate one editor to create offline changes, then push manually.
                </p>
            </header>

            <section className="network-toolbar">
                <div className="pill-row">
                    <span className={`pill ${autoMergeOn ? "pill-online" : "pill-split"}`}>Auto merge {autoMergeOn ? "ON" : "PARTITIONED"}</span>
                    <span className="pill">Pending A -&gt; B: {pending.aToB}</span>
                    <span className="pill">Pending B -&gt; A: {pending.bToA}</span>
                </div>

                <div className="button-row">
                    <button type="button" onClick={() => syncDocs("both", "Manual two-way sync")} className="btn btn-primary">
                        Sync Both Now
                    </button>
                    <button type="button" onClick={resetDemo} className="btn btn-ghost">
                        Reset Demo
                    </button>
                </div>
            </section>

            <section className="editor-grid">
                <article className="editor-card">
                    <div className="editor-top-controls">
                        <button type="button" onClick={() => toggleIsolation("A")} className="btn btn-secondary btn-isolate">
                            {connection.A ? "Isolate Editor A" : "Reconnect Editor A"}
                        </button>
                    </div>

                    <div className="editor-heading">
                        <h2>Editor A</h2>
                        <span className={`status-dot ${connection.A ? "status-connected" : "status-isolated"}`}>
                            {connection.A ? "Connected" : "Isolated"}
                        </span>
                    </div>

                    <textarea
                        value={editorA.text}
                        onChange={(event) => applyEditorChange("A", event.target.value)}
                        className="editor-input"
                        placeholder="Type in Editor A"
                        spellCheck={false}
                        aria-label="Editor A"
                    />

                    <div className="editor-actions">
                        <button type="button" onClick={() => syncDocs("AtoB", "Manual push from Editor A")} className="btn btn-primary">
                            Push A -&gt; B
                        </button>
                    </div>

                    <details className="under-hood" open>
                        <summary>Under the hood</summary>
                        <div className="hood-columns">
                            <div>
                                <h3>Version Vector</h3>
                                <pre>{JSON.stringify(editorA.version, null, 2)}</pre>
                            </div>
                            <div>
                                <h3>CRDT Items</h3>
                                <div className="table-wrap">
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>ID</th>
                                                <th>Char</th>
                                                <th>Deleted</th>
                                                <th>Origin L</th>
                                                <th>Origin R</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {editorA.items.length === 0 ? (
                                                <tr>
                                                    <td colSpan={5}>No items yet.</td>
                                                </tr>
                                            ) : (
                                                editorA.items.map((item, index) => (
                                                    <tr key={`${item.id[0]}-${item.id[1]}-${index}`} className={item.deleted ? "row-deleted" : ""}>
                                                        <td>{formatId(item.id)}</td>
                                                        <td>{formatChar(item.content)}</td>
                                                        <td>{item.deleted ? "yes" : "no"}</td>
                                                        <td>{formatId(item.originLeft)}</td>
                                                        <td>{formatId(item.originRight)}</td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </details>
                </article>

                <article className="editor-card">
                    <div className="editor-top-controls">
                        <button type="button" onClick={() => toggleIsolation("B")} className="btn btn-secondary btn-isolate">
                            {connection.B ? "Isolate Editor B" : "Reconnect Editor B"}
                        </button>
                    </div>

                    <div className="editor-heading">
                        <h2>Editor B</h2>
                        <span className={`status-dot ${connection.B ? "status-connected" : "status-isolated"}`}>
                            {connection.B ? "Connected" : "Isolated"}
                        </span>
                    </div>

                    <textarea
                        value={editorB.text}
                        onChange={(event) => applyEditorChange("B", event.target.value)}
                        className="editor-input"
                        placeholder="Type in Editor B"
                        spellCheck={false}
                        aria-label="Editor B"
                    />

                    <div className="editor-actions">
                        <button type="button" onClick={() => syncDocs("BtoA", "Manual push from Editor B")} className="btn btn-primary">
                            Push B -&gt; A
                        </button>
                    </div>

                    <details className="under-hood" open>
                        <summary>Under the hood</summary>
                        <div className="hood-columns">
                            <div>
                                <h3>Version Vector</h3>
                                <pre>{JSON.stringify(editorB.version, null, 2)}</pre>
                            </div>
                            <div>
                                <h3>CRDT Items</h3>
                                <div className="table-wrap">
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>ID</th>
                                                <th>Char</th>
                                                <th>Deleted</th>
                                                <th>Origin L</th>
                                                <th>Origin R</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {editorB.items.length === 0 ? (
                                                <tr>
                                                    <td colSpan={5}>No items yet.</td>
                                                </tr>
                                            ) : (
                                                editorB.items.map((item, index) => (
                                                    <tr key={`${item.id[0]}-${item.id[1]}-${index}`} className={item.deleted ? "row-deleted" : ""}>
                                                        <td>{formatId(item.id)}</td>
                                                        <td>{formatChar(item.content)}</td>
                                                        <td>{item.deleted ? "yes" : "no"}</td>
                                                        <td>{formatId(item.originLeft)}</td>
                                                        <td>{formatId(item.originRight)}</td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </details>
                </article>
            </section>

            <section className="timeline-card">
                <h2>Action Timeline</h2>
                <ul className="timeline-list">
                    {logs.length === 0 ? (
                        <li className="timeline-empty">No actions yet.</li>
                    ) : (
                        logs.map((entry) => (
                            <li key={entry.id} className={`timeline-item timeline-${entry.kind}`}>
                                <span className="timeline-time">{entry.time}</span>
                                <span>{entry.message}</span>
                            </li>
                        ))
                    )}
                </ul>
            </section>
        </div>
    );
}

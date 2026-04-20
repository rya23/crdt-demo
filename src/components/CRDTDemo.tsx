import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRightLeftIcon, GitMergeIcon, RefreshCcwIcon, UploadIcon, WifiIcon, WifiOffIcon } from "lucide-react";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import CRDTDocument, { type Item, type Version } from "@/utils/crdt";

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

function timelineTone(kind: LogKind): string {
    if (kind === "local") return "border-secondary/60 bg-secondary/20";
    if (kind === "sync") return "border-primary/45 bg-primary/8";
    return "border-accent/70 bg-accent/20";
}

function timelineVariant(kind: LogKind): "default" | "secondary" | "outline" {
    if (kind === "sync") return "default";
    if (kind === "local") return "secondary";
    return "outline";
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

    const renderEditorPanel = (editorId: EditorId, snapshotData: EditorSnapshot) => {
        const connected = connection[editorId];
        const pushDirection: SyncDirection = editorId === "A" ? "AtoB" : "BtoA";
        const pushLabel = editorId === "A" ? "Push A -> B" : "Push B -> A";

        return (
            <Card key={editorId} className="border-border/70 bg-card/90">
                <CardHeader>
                    <CardTitle className="text-xl">{editorLabel(editorId)}</CardTitle>
                    <CardDescription>
                        {connected ? "Connected: local edits sync instantly." : "Isolated: local edits stay local until pushed."}
                    </CardDescription>
                    <CardAction className="flex items-center gap-2">
                        <Badge variant={connected ? "default" : "outline"}>{connected ? "Connected" : "Isolated"}</Badge>
                        <Button type="button" variant="outline" size="sm" onClick={() => toggleIsolation(editorId)}>
                            {connected ? <WifiOffIcon data-icon="inline-start" /> : <WifiIcon data-icon="inline-start" />}
                            {connected ? `Isolate ${editorLabel(editorId)}` : `Reconnect ${editorLabel(editorId)}`}
                        </Button>
                    </CardAction>
                </CardHeader>

                <CardContent className="flex flex-col gap-3">
                    <Textarea
                        value={snapshotData.text}
                        onChange={(event) => applyEditorChange(editorId, event.target.value)}
                        className="min-h-44 resize-y font-mono text-sm"
                        placeholder={`Type in ${editorLabel(editorId)}`}
                        spellCheck={false}
                        aria-label={editorLabel(editorId)}
                    />

                    <div className="flex justify-end">
                        <Button type="button" onClick={() => syncDocs(pushDirection, `Manual push from ${editorLabel(editorId)}`)}>
                            <UploadIcon data-icon="inline-start" />
                            {pushLabel}
                        </Button>
                    </div>

                    <Accordion type="single" collapsible defaultValue="under-the-hood">
                        <AccordionItem value="under-the-hood">
                            <AccordionTrigger>Under the hood</AccordionTrigger>
                            <AccordionContent>
                                <div className="flex flex-col gap-3 lg:flex-row">
                                    <div className="w-full lg:max-w-56">
                                        <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Version Vector</p>
                                        <pre className="overflow-auto rounded-lg border bg-muted/25 p-2 font-mono text-xs leading-relaxed">
                                            {JSON.stringify(snapshotData.version, null, 2)}
                                        </pre>
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">CRDT Items</p>
                                        <ScrollArea className="h-44 rounded-lg border bg-background/80">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead>ID</TableHead>
                                                        <TableHead>Char</TableHead>
                                                        <TableHead>Deleted</TableHead>
                                                        <TableHead>Origin L</TableHead>
                                                        <TableHead>Origin R</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {snapshotData.items.length === 0 ? (
                                                        <TableRow>
                                                            <TableCell colSpan={5} className="text-muted-foreground">
                                                                No items yet.
                                                            </TableCell>
                                                        </TableRow>
                                                    ) : (
                                                        snapshotData.items.map((item, index) => (
                                                            <TableRow
                                                                key={`${item.id[0]}-${item.id[1]}-${index}`}
                                                                className={cn(item.deleted && "text-muted-foreground line-through")}
                                                            >
                                                                <TableCell className="font-mono text-xs">{formatId(item.id)}</TableCell>
                                                                <TableCell className="font-mono text-xs">{formatChar(item.content)}</TableCell>
                                                                <TableCell className="font-mono text-xs">{item.deleted ? "yes" : "no"}</TableCell>
                                                                <TableCell className="font-mono text-xs">{formatId(item.originLeft)}</TableCell>
                                                                <TableCell className="font-mono text-xs">{formatId(item.originRight)}</TableCell>
                                                            </TableRow>
                                                        ))
                                                    )}
                                                </TableBody>
                                            </Table>
                                        </ScrollArea>
                                    </div>
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </CardContent>
            </Card>
        );
    };

    return (
        <div className="flex h-full flex-col gap-4">
            <Card className="border-border/70 bg-card/90">
                <CardHeader>
                    <CardTitle className="text-3xl md:text-4xl">Two Editors With Live Merge</CardTitle>
                    <CardDescription>
                        Type in either editor to generate CRDT operations. Keep both connected for Google Docs style live merge, or isolate one editor
                        to create offline changes and push manually.
                    </CardDescription>
                </CardHeader>

                <CardFooter className="border-t">
                    <div className="flex w-full flex-wrap items-center gap-2">
                        <Badge variant={autoMergeOn ? "default" : "outline"}>
                            <GitMergeIcon data-icon="inline-start" />
                            Auto merge {autoMergeOn ? "ON" : "PARTITIONED"}
                        </Badge>
                        <Badge variant="secondary">Pending A -&gt; B: {pending.aToB}</Badge>
                        <Badge variant="secondary">Pending B -&gt; A: {pending.bToA}</Badge>

                        <div className="ml-auto flex flex-wrap gap-2">
                            <Button type="button" variant="secondary" onClick={() => syncDocs("both", "Manual two-way sync")}>
                                <ArrowRightLeftIcon data-icon="inline-start" />
                                Sync both now
                            </Button>
                            <Button type="button" variant="outline" onClick={resetDemo}>
                                <RefreshCcwIcon data-icon="inline-start" />
                                Reset demo
                            </Button>
                        </div>
                    </div>
                </CardFooter>
            </Card>

            <Separator />

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {renderEditorPanel("A", editorA)}
                {renderEditorPanel("B", editorB)}
            </section>

            <Card className="border-border/70 bg-card/90">
                <CardHeader>
                    <CardTitle>Action Timeline</CardTitle>
                    <CardDescription>Every local edit, network event, and sync operation appears here in order.</CardDescription>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-72 rounded-lg border bg-background/80">
                        <ul className="flex flex-col gap-2 p-3">
                            {logs.length === 0 ? (
                                <li className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No actions yet.</li>
                            ) : (
                                logs.map((entry) => (
                                    <li key={entry.id} className={cn("flex items-start gap-3 rounded-lg border p-2", timelineTone(entry.kind))}>
                                        <Badge variant={timelineVariant(entry.kind)}>{entry.kind.toUpperCase()}</Badge>
                                        <div className="min-w-0 flex-1">
                                            <p className="mb-1 font-mono text-xs text-muted-foreground">{entry.time}</p>
                                            <p className="text-sm wrap-break-word">{entry.message}</p>
                                        </div>
                                    </li>
                                ))
                            )}
                        </ul>
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
    );
}

export type ID = [agent: string, seq: number];

export type Item = {
    content: string;
    id: ID;
    originLeft: ID | null;
    originRight: ID | null;
    deleted: boolean;
};

export type Version = Record<string, number>;

export type Doc = {
    content: Item[];
    version: Version;
};

function cloneId(id: ID): ID;
function cloneId(id: ID | null): ID | null;
function cloneId(id: ID | null): ID | null {
    if (id == null) return null;
    return [id[0], id[1]];
}

function cloneItem(item: Item): Item {
    return {
        content: item.content,
        id: cloneId(item.id),
        originLeft: cloneId(item.originLeft),
        originRight: cloneId(item.originRight),
        deleted: item.deleted,
    };
}

function cloneDoc(doc: Doc): Doc {
    return {
        content: doc.content.map(cloneItem),
        version: { ...doc.version },
    };
}

function createDoc(): Doc {
    return {
        content: [],
        version: {},
    };
}

function getContent(doc: Doc): string {
    let text = "";

    for (const item of doc.content) {
        if (!item.deleted) {
            text += item.content;
        }
    }
    return text;
}

const findItemAtPos = (doc: Doc, pos: number, stickEnd: boolean = false): number => {
    let i = 0;
    // console.log('pos', pos, doc.length, doc.content.length)
    for (; i < doc.content.length; i++) {
        const item = doc.content[i];
        if (stickEnd && pos === 0) return i;
        else if (item.deleted) continue;
        else if (pos === 0) return i;

        pos--;
    }

    if (pos === 0) return i;
    else throw Error("past end of the document");
};

function localInsertOne(doc: Doc, agent: string, pos: number, text: string) {
    let seq = 0;
    if (doc.version[agent] != null) {
        seq = doc.version[agent] + 1;
    }
    const idx = findItemAtPos(doc, pos, true);

    merge(doc, {
        content: text,
        id: [agent, seq],
        originLeft: doc.content[idx - 1]?.id ?? null,
        originRight: doc.content[idx]?.id ?? null,
        deleted: false,
    });
}

function localInsert(doc: Doc, agent: string, pos: number, text: string) {
    const content = [...text];

    for (const c of content) {
        localInsertOne(doc, agent, pos, c);
        pos++;
    }
}

function remoteInsert(doc: Doc, item: Item) {
    merge(doc, cloneItem(item));
}

function localDelete(doc: Doc, pos: number, delLen: number) {
    while (delLen > 0) {
        const idx = findItemAtPos(doc, pos, false);
        doc.content[idx].deleted = true;
        delLen--;
    }
}

function isEqual(a: ID | null, b: ID | null): boolean {
    if (a === null && b === null) {
        return true;
    }

    if (a !== null && b !== null) {
        return a[0] === b[0] && a[1] === b[1];
    }

    return false;
}

function findItemIndexAtId(doc: Doc, id: ID | null): number | null {
    if (id == null) return null;

    for (let i = 0; i < doc.content.length; i++) {
        if (isEqual(doc.content[i].id, id)) return i;
    }
    throw Error("Id is missing");
}

function merge(doc: Doc, newItem: Item) {
    // template code not written on own

    const [agent, seq] = newItem.id;
    const lastSeen = doc.version[agent] ?? -1;
    if (seq !== lastSeen + 1) throw Error("Operations out of order");

    // Mark the item in the document version.
    doc.version[agent] = seq;

    // If originLeft is null, that means it was inserted at the start of the document.
    // We'll pretend there was some item at position -1 which we were inserted to the
    // right of.
    const left = findItemIndexAtId(doc, newItem.originLeft) ?? -1;
    let destIdx = left + 1;
    const right = newItem.originRight == null ? doc.content.length : findItemIndexAtId(doc, newItem.originRight)!;
    let scanning = false;

    // This loop scans forward from destIdx until it finds the right place to insert into
    // the list.
    for (let i = destIdx; ; i++) {
        if (!scanning) destIdx = i;
        // If we reach the end of the document, just insert.
        if (i === doc.content.length) break;
        if (i === right) break; // No ambiguity / concurrency. Insert here.

        const other = doc.content[i];

        const oleft = findItemIndexAtId(doc, other.originLeft) ?? -1;
        const oright = other.originRight == null ? doc.content.length : findItemIndexAtId(doc, other.originRight)!;

        // The logic below summarizes to:
        // if (oleft < left || (oleft === left && oright === right && newItem.id[0] < other.id[0])) break;
        // if (oleft === left) scanning = oright < right;

        if (oleft < left) {
            // Top row. Insert, insert, arbitrary (insert)
            break;
        } else if (oleft === left) {
            // Middle row.
            if (oright < right) {
                scanning = true;
                continue;
            } else if (oright === right) {
                // Raw conflict. Order based on user agents.
                if (newItem.id[0] < other.id[0]) break;
                else {
                    scanning = false;
                    continue;
                }
            } else {
                // oright > right
                scanning = false;
                continue;
            }
        } else {
            // oleft > left
            // Bottom row. Arbitrary (skip), skip, skip
            continue;
        }
    }

    // We've found the position. Insert here.
    doc.content.splice(destIdx, 0, newItem);
    // if (!newItem.deleted) doc.length += 1
}

function isInVersion(id: ID | null, version: Version): boolean {
    if (id == null) return true;
    const [agent, seq] = id;
    const highestSeq = version[agent];
    if (highestSeq == null) {
        return false;
    } else {
        return highestSeq >= seq;
    }

    // return highestSeq != null && highestSeq >= seq
}

function canInsertNow(item: Item, doc: Doc): boolean {
    // We need item.id to not be in doc.versions, but originLeft and originRight to be in.
    // We're also inserting each item from each agent in sequence.
    const [agent, seq] = item.id;
    return (
        !isInVersion(item.id, doc.version) &&
        (seq === 0 || isInVersion([agent, seq - 1], doc.version)) &&
        isInVersion(item.originLeft, doc.version) &&
        isInVersion(item.originRight, doc.version)
    );
}

function mergeInto(dest: Doc, src: Doc) {
    const missing: (Item | null)[] = src.content.filter((item) => !isInVersion(item.id, dest.version));
    let remaining = missing.length;

    while (remaining > 0) {
        // Find the next item in remaining and insert it.
        let mergedOnThisPass = 0;

        for (let i = 0; i < missing.length; i++) {
            const item = missing[i];
            if (item == null) continue;
            if (!canInsertNow(item, dest)) continue;

            // Insert it.
            remoteInsert(dest, item);
            missing[i] = null;
            remaining--;
            mergedOnThisPass++;
        }

        if (mergedOnThisPass === 0) throw Error("Not making progress");
    }

    let srcIdx = 0,
        destIdx = 0;
    while (srcIdx < src.content.length) {
        const srcItem = src.content[srcIdx];
        let destItem = dest.content[destIdx];

        while (!isEqual(srcItem.id, destItem.id)) {
            destIdx++;
            destItem = dest.content[destIdx];
        }

        if (srcItem.deleted) {
            destItem.deleted = true;
        }

        srcIdx++;
        destIdx++;
    }
}

export class CRDTDocument {
    private readonly doc: Doc;

    constructor(initialDoc?: Doc) {
        this.doc = initialDoc ? cloneDoc(initialDoc) : createDoc();
    }

    static fromDoc(doc: Doc): CRDTDocument {
        return new CRDTDocument(doc);
    }

    getText(): string {
        return getContent(this.doc);
    }

    insert(agent: string, pos: number, text: string): void {
        localInsert(this.doc, agent, pos, text);
    }

    insertOne(agent: string, pos: number, char: string): void {
        if ([...char].length !== 1) {
            throw Error("insertOne expects exactly one character");
        }
        localInsertOne(this.doc, agent, pos, char);
    }

    delete(pos: number, length: number): void {
        localDelete(this.doc, pos, length);
    }

    mergeFrom(source: CRDTDocument | Doc): void {
        const sourceDoc = source instanceof CRDTDocument ? source.doc : source;
        mergeInto(this.doc, sourceDoc);
    }

    applyRemoteInsert(item: Item): void {
        remoteInsert(this.doc, item);
    }

    toDoc(): Doc {
        return cloneDoc(this.doc);
    }

    getItems(): Item[] {
        return this.doc.content.map(cloneItem);
    }

    getVersion(): Version {
        return { ...this.doc.version };
    }
}

export function createCRDTDocument(initialDoc?: Doc): CRDTDocument {
    return new CRDTDocument(initialDoc);
}

export default CRDTDocument;

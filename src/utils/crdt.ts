type ID = [agent: string, seq: number];

type Item = {
    content: string;
    id: ID;
    originLeft: ID | null;
    originRight: ID | null;
    deleted: boolean;
};

type Version = Record<string, number>;

type Doc = {
    content: Item[];
    version: Version;
};

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

function localInsertOne(doc: Doc, agent: string, pos: number, text: string) {
    let seq = 0;
    if (doc.version[agent] != null) {
        seq = doc.version[agent] + 1;
    }

    merge(doc, {
        content: text,
        id: [agent, seq],
        originLeft: doc.content[pos - 1]?.id ?? null,
        originRight: doc.content[pos]?.id ?? null,
        deleted: false,
    });
}

function localInsert(doc: Doc, agent: string, seq: number, pos: number, text: string) {
    const content = [...text];

    for (const c of content) {
        localInsertOne(doc, agent, pos, c);
        pos++;
    }
}

function remoteInsert(doc: Doc, item: Item) {
    merge(doc, item);
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
    let left = findItemIndexAtId(doc, newItem.originLeft) ?? -1;
    let destIdx = left + 1;
    let right = newItem.originRight == null ? doc.content.length : findItemIndexAtId(doc, newItem.originRight)!;
    let scanning = false;

    // This loop scans forward from destIdx until it finds the right place to insert into
    // the list.
    for (let i = destIdx; ; i++) {
        if (!scanning) destIdx = i;
        // If we reach the end of the document, just insert.
        if (i === doc.content.length) break;
        if (i === right) break; // No ambiguity / concurrency. Insert here.

        let other = doc.content[i];

        let oleft = findItemIndexAtId(doc, other.originLeft) ?? -1;
        let oright = other.originRight == null ? doc.content.length : findItemIndexAtId(doc, other.originRight)!;

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

const doc = createDoc();

localInsertOne(doc, "rya", 0, "a");

localInsertOne(doc, "rya", 0, "q");

localInsertOne(doc, "rya", 0, "c");
console.log("DocContent : ", getContent(doc));
console.table(doc.content);

import CRDTDemo from "@/components/CRDTDemo";

function App() {
    return (
        <div className="relative min-h-screen bg-background">
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_75%_at_10%_5%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_62%),radial-gradient(65%_65%_at_92%_10%,color-mix(in_oklch,var(--accent)_28%,transparent),transparent_60%),linear-gradient(to_bottom,color-mix(in_oklch,var(--background)_88%,white),var(--background))]"
            />
            <main className="relative flex min-h-screen flex-col p-3 md:p-5">
                <CRDTDemo />
            </main>
        </div>
    );
}

export default App;

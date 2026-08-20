function App() {
  return (
    <div className="flex h-screen w-screen bg-gray-950 text-white">
      <aside className="w-60 border-r border-gray-800 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
          Node Palette
        </h2>
      </aside>
      <main className="flex flex-1 flex-col">
        <header className="flex items-center gap-4 border-b border-gray-800 px-4 py-2">
          <h1 className="text-lg font-bold">Analysys</h1>
        </header>
        <div className="flex-1">
          {/* Canvas will go here */}
        </div>
      </main>
      <aside className="w-80 border-l border-gray-800 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
          Telemetry
        </h2>
      </aside>
    </div>
  );
}

export default App;

export default function Header() {
  return (
    <header className="flex items-center justify-between mb-10">
      <div className="flex items-center gap-4">
        <img src="/logo/scala-logo.svg" alt="Scala" className="h-8 w-auto" />
        <div className="w-px h-6 bg-white/10" />
        <div>
          <h1 className="text-lg font-bold text-scala-text-primary leading-tight">
            Leads Scraper
          </h1>
          <p className="text-xs text-scala-text-muted">
            Google Maps + extracción de emails
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/5">
        <span className="w-1.5 h-1.5 rounded-full bg-scala-green animate-pulse" />
        <span className="text-xs text-scala-text-muted font-medium">Sistema activo</span>
      </div>
    </header>
  )
}

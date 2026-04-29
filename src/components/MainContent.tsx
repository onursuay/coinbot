'use client'

export default function MainContent({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex-1 flex flex-col overflow-hidden min-w-0"
      onClick={() => window.dispatchEvent(new Event('sidebar:close-groups'))}
    >
      {children}
    </div>
  )
}

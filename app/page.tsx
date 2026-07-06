import BattleshipSolver from '@/components/BattleshipSolver'

export default function Page() {
  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        <BattleshipSolver />
      </div>
    </main>
  )
}

import { createPool } from '../src/kernel/db.js'

async function main(): Promise<void> {
  const pool = await createPool()
  await pool.end()
  console.log('Migrations completed successfully.')
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})

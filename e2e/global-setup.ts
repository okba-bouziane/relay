import { execSync } from 'node:child_process'

export default function setup() {
  execSync('npm run db:seed', { stdio: 'inherit' })
}

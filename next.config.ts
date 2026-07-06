import type { NextConfig } from 'next'

const isProduction = process.env.NODE_ENV === 'production'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'export',
  distDir: isProduction ? 'docs' : 'out',
  basePath: isProduction ? '/BattleshipSolver' : '',
  assetPrefix: isProduction ? '/TafelKampioen' : '',
}

export default nextConfig

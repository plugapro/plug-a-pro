import nextConfig from 'eslint-config-next'
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'

const reactCompilerWarnings = {
  rules: {
    'react-hooks/preserve-manual-memoization': 'warn',
    'react-hooks/purity': 'warn',
    'react-hooks/set-state-in-effect': 'warn',
    'react-hooks/static-components': 'warn',
  },
}

const config = [...nextConfig, ...nextCoreWebVitals, reactCompilerWarnings]
export default config

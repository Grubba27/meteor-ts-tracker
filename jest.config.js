/* eslint-disable @typescript-eslint/no-unsafe-argument */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleDirectories: ['node_modules', 'src'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
}

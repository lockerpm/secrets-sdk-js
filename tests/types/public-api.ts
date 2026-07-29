import {
  Action,
  EmptyOutputError,
  Environment,
  Locker,
  Secret,
  Target,
  type Executor,
  type IEnvironmentPage,
  type IEnvironment,
  type ISecretPage,
  type ISecret,
  type PageRequest,
  type ProtocolExecutor,
} from '../../index.js'

const legacyExecutor: Executor = {
  async runCommand() {
    return ''
  },
  runCommandSync() {
    return ''
  },
}

const protocolExecutor: ProtocolExecutor = {
  async execute<T>() {
    return undefined as T
  },
  executeSync<T>() {
    return undefined as T
  },
}

const legacySecret: ISecret = {
  key: 'API_KEY',
  value: 'value',
  description: '',
  environmentName: null,
}
const legacyEnvironment: IEnvironment = {
  name: 'production',
  externalUrl: '',
  description: '',
}

const locker = new Locker({
  accessKeyId: 'access-id',
  secretAccessKey: 'secret-access-key',
  executor: protocolExecutor,
})
const secret = new Secret({ key: 'API_KEY', value: 'value' })
const environment = new Environment({ name: 'production' })
const pageRequest: PageRequest = { pageSize: 100 }
const secretPage: Promise<ISecretPage> = locker.listPage(pageRequest)
const environmentPage: Promise<IEnvironmentPage> =
  locker.listEnvironmentsPage(pageRequest)
// @ts-expect-error Page requests are immutable public DTOs.
pageRequest.pageSize = 200

void legacyExecutor
void legacySecret
void legacyEnvironment
void locker.getRequiredSync('API_KEY')
void secret
void environment
void secretPage
void environmentPage
void new EmptyOutputError()
void Action.GET
void Target.SECRET

import ProposerForm from '@/components/tx/SignOrExecuteForm/ProposerForm'
import CounterfactualForm from '@/features/counterfactual/CounterfactualForm'
import { useIsWalletProposer } from '@/hooks/useProposers'
import useSafeInfo from '@/hooks/useSafeInfo'
import { type ReactElement, type ReactNode, useState, useContext, useCallback } from 'react'
import madProps from '@/utils/mad-props'
import ExecuteCheckbox from '../ExecuteCheckbox'
import { useImmediatelyExecutable, useValidateNonce } from './hooks'
import ExecuteForm from './ExecuteForm'
import SignForm from './SignForm'
import { SafeTxContext } from '@/components/tx-flow/SafeTxProvider'
import ErrorMessage from '../ErrorMessage'
import TxChecks from './TxChecks'
import TxCard from '@/components/tx-flow/common/TxCard'
import ConfirmationTitle, { ConfirmationTitleTypes } from '@/components/tx/SignOrExecuteForm/ConfirmationTitle'
import { useAppSelector } from '@/store'
import { selectSettings } from '@/store/settingsSlice'
import UnknownContractError from './UnknownContractError'
import { ErrorBoundary } from '@sentry/react'
import ApprovalEditor from '../ApprovalEditor'
import { isDelegateCall } from '@/services/tx/tx-sender/sdk'
import { getTransactionTrackingType } from '@/services/analytics/tx-tracking'
import { TX_EVENTS } from '@/services/analytics/events/transactions'
import { trackEvent } from '@/services/analytics'
import useChainId from '@/hooks/useChainId'
import ExecuteThroughRoleForm from './ExecuteThroughRoleForm'
import { findAllowingRole, findMostLikelyRole, useRoles } from './ExecuteThroughRoleForm/hooks'
import useIsSafeOwner from '@/hooks/useIsSafeOwner'
import { BlockaidBalanceChanges } from '../security/blockaid/BlockaidBalanceChange'
import { Blockaid } from '../security/blockaid'

import { MigrateToL2Information } from './MigrateToL2Information'
import { extractMigrationL2MasterCopyAddress } from '@/utils/transactions'

import { useLazyGetTransactionDetailsQuery } from '@/store/api/gateway'
import { useApprovalInfos } from '../ApprovalEditor/hooks/useApprovalInfos'

import type { TransactionDetails } from '@safe-global/safe-gateway-typescript-sdk'
import NetworkWarning from '@/components/new-safe/create/NetworkWarning'
import ConfirmationView from '../confirmation-views'
import { SignerForm } from './SignerForm'
import { useSigner } from '@/hooks/wallets/useWallet'
import { isNestedConfirmationTxInfo } from '@/utils/transaction-guards'
import TxNoteForm from './TxNoteForm'

export type SubmitCallback = (txId: string, isExecuted?: boolean) => void

export type SignOrExecuteProps = {
  txId?: string
  onSubmit?: SubmitCallback
  children?: ReactNode
  isExecutable?: boolean
  isRejection?: boolean
  isBatch?: boolean
  isBatchable?: boolean
  onlyExecute?: boolean
  disableSubmit?: boolean
  origin?: string
  showMethodCall?: boolean
}

const trackTxEvents = (
  details: TransactionDetails | undefined,
  isCreation: boolean,
  isExecuted: boolean,
  isRoleExecution: boolean,
  isProposerCreation: boolean,
  isParentSigner: boolean,
  origin?: string,
) => {
  const isNestedConfirmation = !!details && isNestedConfirmationTxInfo(details.txInfo)

  const creationEvent = getCreationEvent({ isParentSigner, isRoleExecution, isProposerCreation })
  const confirmationEvent = getConfirmationEvent({ isParentSigner, isNestedConfirmation })
  const executionEvent = getExecutionEvent({ isParentSigner, isNestedConfirmation, isRoleExecution })

  const event = (() => {
    if (isCreation) {
      return creationEvent
    }
    if (isExecuted) {
      return executionEvent
    }
    return confirmationEvent
  })()

  const txType = getTransactionTrackingType(details, origin)
  trackEvent({ ...event, label: txType })

  // Immediate execution on creation
  if (isCreation && isExecuted) {
    trackEvent({ ...executionEvent, label: txType })
  }
}

function getCreationEvent(args: { isParentSigner: boolean; isRoleExecution: boolean; isProposerCreation: boolean }) {
  if (args.isParentSigner) {
    return TX_EVENTS.CREATE_VIA_PARENT
  }
  if (args.isRoleExecution) {
    return TX_EVENTS.CREATE_VIA_ROLE
  }
  if (args.isProposerCreation) {
    return TX_EVENTS.CREATE_VIA_PROPOSER
  }
  return TX_EVENTS.CREATE
}

function getConfirmationEvent(args: { isParentSigner: boolean; isNestedConfirmation: boolean }) {
  if (args.isParentSigner) {
    return TX_EVENTS.CONFIRM_VIA_PARENT
  }
  if (args.isNestedConfirmation) {
    return TX_EVENTS.CONFIRM_IN_PARENT
  }
  return TX_EVENTS.CONFIRM
}

function getExecutionEvent(args: { isParentSigner: boolean; isNestedConfirmation: boolean; isRoleExecution: boolean }) {
  if (args.isParentSigner) {
    return TX_EVENTS.EXECUTE_VIA_PARENT
  }
  if (args.isNestedConfirmation) {
    return TX_EVENTS.EXECUTE_IN_PARENT
  }
  if (args.isRoleExecution) {
    return TX_EVENTS.EXECUTE_VIA_ROLE
  }
  return TX_EVENTS.EXECUTE
}

export const SignOrExecuteForm = ({
  chainId,
  safeTx,
  safeTxError,
  onSubmit,
  isCreation,
  ...props
}: SignOrExecuteProps & {
  chainId: ReturnType<typeof useChainId>
  safeTx: ReturnType<typeof useSafeTx>
  safeTxError: ReturnType<typeof useSafeTxError>
  isCreation?: boolean
  txDetails?: TransactionDetails
}): ReactElement => {
  const [customOrigin, setCustomOrigin] = useState<string | undefined>(props.origin)
  const { transactionExecution } = useAppSelector(selectSettings)
  const [shouldExecute, setShouldExecute] = useState<boolean>(transactionExecution)
  const isNewExecutableTx = useImmediatelyExecutable() && isCreation
  const isCorrectNonce = useValidateNonce(safeTx)
  const isBatchable = props.isBatchable !== false && safeTx && !isDelegateCall(safeTx)

  const [trigger] = useLazyGetTransactionDetailsQuery()
  const [readableApprovals] = useApprovalInfos({ safeTransaction: safeTx })
  const isApproval = readableApprovals && readableApprovals.length > 0
  const { safe } = useSafeInfo()
  const isSafeOwner = useIsSafeOwner()
  const signer = useSigner()
  const isProposer = useIsWalletProposer()
  const isProposing = isProposer && !isSafeOwner && isCreation
  const isCounterfactualSafe = !safe.deployed
  const multiChainMigrationTarget = extractMigrationL2MasterCopyAddress(safeTx)
  const isMultiChainMigration = !!multiChainMigrationTarget

  // Check if a Zodiac Roles mod is enabled and if the user is a member of any role that allows the transaction
  const roles = useRoles(
    !isCounterfactualSafe && isCreation && !(isNewExecutableTx && isSafeOwner) ? safeTx : undefined,
  )
  const allowingRole = findAllowingRole(roles)
  const mostLikelyRole = findMostLikelyRole(roles)
  const canExecuteThroughRole = !!allowingRole || (!!mostLikelyRole && !isSafeOwner)
  const preferThroughRole = canExecuteThroughRole && !isSafeOwner // execute through role if a non-owner role member wallet is connected

  // If checkbox is checked and the transaction is executable, execute it, otherwise sign it
  const canExecute = isCorrectNonce && (props.isExecutable || isNewExecutableTx)
  const willExecute = (props.onlyExecute || shouldExecute) && canExecute && !preferThroughRole
  const willExecuteThroughRole =
    (props.onlyExecute || shouldExecute) && canExecuteThroughRole && (!canExecute || preferThroughRole)

  const onFormSubmit = useCallback(
    async (txId: string, isExecuted = false, isRoleExecution = false, isProposerCreation = false) => {
      onSubmit?.(txId, isExecuted)

      const { data: details } = await trigger({ chainId, txId })
      // Track tx event
      trackTxEvents(
        details,
        !!isCreation,
        isExecuted,
        isRoleExecution,
        isProposerCreation,
        !!signer?.isSafe,
        props.origin,
      )
    },
    [chainId, isCreation, onSubmit, trigger, signer?.isSafe, props.origin],
  )

  const onRoleExecutionSubmit = useCallback<typeof onFormSubmit>(
    (txId, isExecuted) => onFormSubmit(txId, isExecuted, true),
    [onFormSubmit],
  )

  const onProposerFormSubmit = useCallback<typeof onFormSubmit>(
    (txId, isExecuted) => onFormSubmit(txId, isExecuted, false, true),
    [onFormSubmit],
  )

  const onNoteSubmit = useCallback(
    (note: string) => {
      const originalOrigin = props.origin ? JSON.parse(props.origin) : { url: location.origin }
      setCustomOrigin(
        JSON.stringify({
          ...originalOrigin,
          name: JSON.stringify({ note }),
        }),
      )
    },
    [setCustomOrigin, props.origin],
  )

  return (
    <>
      <TxCard>
        {props.children}
        {isMultiChainMigration && <MigrateToL2Information variant="queue" newMasterCopy={multiChainMigrationTarget} />}

        <ConfirmationView
          isCreation={isCreation}
          txDetails={props.txDetails}
          safeTx={safeTx}
          isBatch={props.isBatch}
          showMethodCall={props.showMethodCall}
          isApproval={isApproval}
        >
          {!props.isRejection && (
            <ErrorBoundary fallback={<div>Error parsing data</div>}>
              {isApproval && <ApprovalEditor safeTransaction={safeTx} />}
            </ErrorBoundary>
          )}
        </ConfirmationView>

        {!isCounterfactualSafe && !props.isRejection && <BlockaidBalanceChanges />}
      </TxCard>

      {!isCounterfactualSafe && !props.isRejection && <TxChecks />}

      {isCreation && <TxNoteForm onSubmit={onNoteSubmit} />}

      <SignerForm willExecute={willExecute} />

      <TxCard>
        <ConfirmationTitle
          variant={
            isProposing
              ? ConfirmationTitleTypes.propose
              : willExecute
                ? ConfirmationTitleTypes.execute
                : ConfirmationTitleTypes.sign
          }
          isCreation={isCreation}
        />

        {safeTxError && (
          <ErrorMessage error={safeTxError}>
            This transaction will most likely fail. To save gas costs, avoid confirming the transaction.
          </ErrorMessage>
        )}

        {(canExecute || canExecuteThroughRole) && !props.onlyExecute && !isCounterfactualSafe && !isProposing && (
          <ExecuteCheckbox onChange={setShouldExecute} />
        )}

        <NetworkWarning />

        {!isMultiChainMigration && <UnknownContractError />}

        <Blockaid />

        {isCounterfactualSafe && !isProposing && (
          <CounterfactualForm {...props} safeTx={safeTx} isCreation={isCreation} onSubmit={onFormSubmit} onlyExecute />
        )}
        {!isCounterfactualSafe && willExecute && !isProposing && (
          <ExecuteForm
            {...props}
            origin={customOrigin}
            safeTx={safeTx}
            isCreation={isCreation}
            onSubmit={onFormSubmit}
          />
        )}
        {!isCounterfactualSafe && willExecuteThroughRole && (
          <ExecuteThroughRoleForm
            {...props}
            safeTx={safeTx}
            safeTxError={safeTxError}
            onSubmit={onRoleExecutionSubmit}
            role={(allowingRole || mostLikelyRole)!}
          />
        )}
        {!isCounterfactualSafe && !willExecute && !willExecuteThroughRole && !isProposing && (
          <SignForm
            {...props}
            origin={customOrigin}
            safeTx={safeTx}
            isBatchable={isBatchable}
            isCreation={isCreation}
            onSubmit={onFormSubmit}
          />
        )}

        {isProposing && <ProposerForm {...props} safeTx={safeTx} onSubmit={onProposerFormSubmit} />}
      </TxCard>
    </>
  )
}

const useSafeTx = () => useContext(SafeTxContext).safeTx
const useSafeTxError = () => useContext(SafeTxContext).safeTxError

export default madProps(SignOrExecuteForm, {
  chainId: useChainId,
  safeTx: useSafeTx,
  safeTxError: useSafeTxError,
})

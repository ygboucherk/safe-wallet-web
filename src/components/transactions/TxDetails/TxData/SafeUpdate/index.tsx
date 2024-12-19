import { Box, Stack } from '@mui/material'
import type { TransactionData } from '@safe-global/safe-gateway-typescript-sdk'
import DecodedData from '../DecodedData'

function SafeUpdate({ txData }: { txData?: TransactionData }) {
  return (
    <Stack mr={5} spacing={2}>
      <Box
        bgcolor="border.background"
        p={2}
        textAlign="center"
        fontWeight={700}
        fontSize={18}
        borderRadius={1}
        width="100%"
      >
        Safe version update
      </Box>

      <DecodedData txData={txData} toInfo={txData?.to} />
    </Stack>
  )
}

export default SafeUpdate

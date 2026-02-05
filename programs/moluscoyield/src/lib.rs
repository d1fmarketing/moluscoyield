use anchor_lang::prelude::*;

declare_id!("MolY1dQfT7mK9JmM8J3nM8bG5sL6cK7dF4eS5tU7vW8");

#[program]
pub mod moluscoyield {
    use super::*;

    /// Initialize a new agent vault for tracking positions
    pub fn initialize_vault(ctx: Context<InitializeVault>, agent_name: String) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = ctx.accounts.owner.key();
        vault.agent_name = agent_name;
        vault.total_value_locked = 0;
        vault.position_count = 0;
        vault.created_at = Clock::get()?.unix_timestamp;
        vault.last_rebalance = 0;
        vault.bump = ctx.bumps.vault;
        
        msg!("Vault initialized for agent: {}", vault.agent_name);
        Ok(())
    }

    /// Record a new yield position
    pub fn open_position(
        ctx: Context<OpenPosition>,
        protocol: String,
        strategy: String,
        asset: String,
        amount: u64,
        target_apy: u16, // Basis points (e.g., 850 = 8.50%)
    ) -> Result<()> {
        let position = &mut ctx.accounts.position;
        let vault = &mut ctx.accounts.vault;
        
        position.owner = ctx.accounts.owner.key();
        position.vault = vault.key();
        position.protocol = protocol;
        position.strategy = strategy;
        position.asset = asset;
        position.amount = amount;
        position.target_apy = target_apy;
        position.opened_at = Clock::get()?.unix_timestamp;
        position.last_update = Clock::get()?.unix_timestamp;
        position.is_active = true;
        position.accumulated_yield = 0;
        position.bump = ctx.bumps.position;
        
        vault.position_count += 1;
        vault.total_value_locked += amount;
        
        msg!("Position opened: {} in {}", asset, protocol);
        Ok(())
    }

    /// Update position value and record yield
    pub fn update_position(
        ctx: Context<UpdatePosition>,
        current_value: u64,
    ) -> Result<()> {
        let position = &mut ctx.accounts.position;
        let now = Clock::get()?.unix_timestamp;
        
        // Calculate yield since last update
        let yield_earned = current_value.saturating_sub(position.amount);
        position.accumulated_yield += yield_earned;
        position.last_update = now;
        
        msg!("Position updated. Yield earned: {} lamports", yield_earned);
        Ok(())
    }

    /// Close a position and record final yield
    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        let position = &mut ctx.accounts.position;
        let vault = &mut ctx.accounts.vault;
        
        position.is_active = false;
        vault.position_count -= 1;
        vault.total_value_locked -= position.amount;
        
        msg!("Position closed. Total yield: {} lamports", position.accumulated_yield);
        Ok(())
    }

    /// Record a rebalance event
    pub fn record_rebalance(ctx: Context<RecordRebalance>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.last_rebalance = Clock::get()?.unix_timestamp;
        
        msg!("Rebalance recorded at timestamp: {}", vault.last_rebalance);
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(agent_name: String)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(
        init,
        payer = owner,
        space = 8 + Vault::SIZE,
        seeds = [b"vault", owner.key().as_ref(), agent_name.as_bytes()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(protocol: String, strategy: String, asset: String)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(
        mut,
        constraint = vault.owner == owner.key()
    )]
    pub vault: Account<'info, Vault>,
    
    #[account(
        init,
        payer = owner,
        space = 8 + Position::SIZE,
        seeds = [
            b"position",
            vault.key().as_ref(),
            protocol.as_bytes(),
            asset.as_bytes(),
            &[vault.position_count as u8]
        ],
        bump
    )]
    pub position: Account<'info, Position>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(
        mut,
        constraint = position.owner == owner.key()
    )]
    pub position: Account<'info, Position>,
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(
        mut,
        constraint = vault.owner == owner.key()
    )]
    pub vault: Account<'info, Vault>,
    
    #[account(
        mut,
        constraint = position.owner == owner.key(),
        constraint = position.vault == vault.key(),
        close = owner
    )]
    pub position: Account<'info, Position>,
}

#[derive(Accounts)]
pub struct RecordRebalance<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(
        mut,
        constraint = vault.owner == owner.key()
    )]
    pub vault: Account<'info, Vault>,
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub agent_name: String,
    pub total_value_locked: u64,
    pub position_count: u16,
    pub created_at: i64,
    pub last_rebalance: i64,
    pub bump: u8,
}

impl Vault {
    pub const SIZE: usize = 32 +      // owner
        4 + 32 +                        // agent_name (String with max 32 chars)
        8 +                             // total_value_locked
        2 +                             // position_count
        8 +                             // created_at
        8 +                             // last_rebalance
        1;                              // bump
}

#[account]
pub struct Position {
    pub owner: Pubkey,
    pub vault: Pubkey,
    pub protocol: String,
    pub strategy: String,
    pub asset: String,
    pub amount: u64,
    pub target_apy: u16,
    pub opened_at: i64,
    pub last_update: i64,
    pub is_active: bool,
    pub accumulated_yield: u64,
    pub bump: u8,
}

impl Position {
    pub const SIZE: usize = 32 +      // owner
        32 +                            // vault
        4 + 16 +                        // protocol (max 16 chars)
        4 + 20 +                        // strategy (max 20 chars)
        4 + 10 +                        // asset (max 10 chars)
        8 +                             // amount
        2 +                             // target_apy
        8 +                             // opened_at
        8 +                             // last_update
        1 +                             // is_active
        8 +                             // accumulated_yield
        1;                              // bump
}

#[error_code]
pub enum MoluscoError {
    #[msg("Invalid APY value")]
    InvalidApy,
    #[msg("Position already closed")]
    PositionClosed,
    #[msg("Insufficient vault balance")]
    InsufficientBalance,
}

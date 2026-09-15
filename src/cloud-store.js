(function () {
  const roleRank = {
    viewer: 1,
    reviewer: 2,
    editor: 3,
    admin: 4,
    owner: 5
  };

  function canRole(role, required) {
    return (roleRank[role] || 0) >= (roleRank[required] || 0);
  }

  function createCloudStore(client) {
    if (!client) throw new Error("Supabase client is required");

    async function currentUser() {
      const { data, error } = await client.auth.getUser();
      if (error) throw error;
      return data.user;
    }

    async function listTeams() {
      const { data, error } = await client
        .from("teams")
        .select("id,name,created_at,team_members(role)")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    }

    async function listTeamMembers(teamId) {
      const { data, error } = await client
        .from("team_members")
        .select("team_id,user_id,role,joined_at,profiles(display_name)")
        .eq("team_id", teamId)
        .order("joined_at", { ascending: true });
      if (error) throw error;
      return data || [];
    }

    async function listMyInvites() {
      const { data, error } = await client
        .from("team_invites")
        .select("id,team_id,email,role,status,created_at,teams(name)")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    }

    async function createTeam(name, displayName = "") {
      const { data, error } = await client.rpc("create_team_with_owner", {
        team_name: name,
        display_name: displayName
      });
      if (error) throw error;
      return data;
    }

    async function inviteMember(teamId, email, role = "reviewer") {
      const user = await currentUser();
      const { data, error } = await client
        .from("team_invites")
        .upsert({
          team_id: teamId,
          email: String(email || "").trim().toLowerCase(),
          role,
          status: "pending",
          invited_by: user.id
        }, { onConflict: "team_id,email" })
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    async function acceptInvite(inviteId, displayName = "") {
      const { data, error } = await client.rpc("accept_team_invite", {
        invite_id: inviteId,
        display_name: displayName
      });
      if (error) throw error;
      return data;
    }

    async function createProject(teamId, name, description = "") {
      const user = await currentUser();
      const { data, error } = await client
        .from("projects")
        .insert({ team_id: teamId, name, description, created_by: user.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    async function listProjects(teamId) {
      const { data, error } = await client
        .from("projects")
        .select("*")
        .eq("team_id", teamId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data || [];
    }

    async function createWorkspace(teamId, projectId, workspace) {
      const user = await currentUser();
      const { data, error } = await client
        .from("workspaces")
        .insert({
          team_id: teamId,
          project_id: projectId,
          name: workspace.name,
          schema_template_id: workspace.schemaTemplateId || "calligraphy-style",
          schema_version: workspace.schemaVersion || 1,
          prompt_version: workspace.promptVersion || 1,
          created_by: user.id
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    async function createMaterial(material) {
      const user = await currentUser();
      const { data, error } = await client
        .from("materials")
        .insert({ ...material, imported_by: user.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    async function listWorkspaces(projectId) {
      const { data, error } = await client
        .from("workspaces")
        .select("*")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data || [];
    }

    async function upsertSourcePages(pages) {
      if (!pages.length) return [];
      const { data, error } = await client
        .from("source_pages")
        .upsert(pages, { onConflict: "workspace_id,source_file" })
        .select();
      if (error) throw error;
      return data || [];
    }

    async function upsertReviewRows(rows) {
      if (!rows.length) return [];
      const { data, error } = await client
        .from("review_rows")
        .upsert(rows, { onConflict: "workspace_id,external_row_id" })
        .select();
      if (error) throw error;
      return data || [];
    }

    async function upsertAnnotations(annotations) {
      if (!annotations.length) return [];
      const { data, error } = await client
        .from("annotations")
        .upsert(annotations, { onConflict: "row_id,external_annotation_id" })
        .select();
      if (error) throw error;
      return data || [];
    }

    async function loadReviewRows(workspaceId) {
      const { data, error } = await client
        .from("review_rows")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("row_number", { ascending: true });
      if (error) throw error;
      return data || [];
    }

    async function loadSourcePages(workspaceId) {
      const { data, error } = await client
        .from("source_pages")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("source_file", { ascending: true });
      if (error) throw error;
      return data || [];
    }

    async function saveReviewRow(rowId, patch) {
      const user = await currentUser();
      const { data, error } = await client
        .from("review_rows")
        .update({ ...patch, updated_by: user.id })
        .eq("id", rowId)
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    async function addReviewEvent(event) {
      const user = await currentUser();
      const { data, error } = await client
        .from("review_events")
        .insert({ ...event, actor_id: user.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    async function signInWithEmail(email, { createUser = true, metadata = {} } = {}) {
      const { data, error } = await client.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: window.location.href.split("#")[0],
          shouldCreateUser: createUser,
          data: metadata
        }
      });
      if (error) throw error;
      return data;
    }

    async function signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    }

    return {
      canRole,
      currentUser,
      signInWithEmail,
      signOut,
      listTeams,
      listTeamMembers,
      listMyInvites,
      createTeam,
      inviteMember,
      acceptInvite,
      createProject,
      listProjects,
      createWorkspace,
      createMaterial,
      listWorkspaces,
      loadReviewRows,
      loadSourcePages,
      upsertSourcePages,
      upsertReviewRows,
      upsertAnnotations,
      saveReviewRow,
      addReviewEvent
    };
  }

  function createSupabaseClient(config) {
    if (!config?.enabled) return null;
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error("Supabase config requires supabaseUrl and supabaseAnonKey");
    }
    if (!window.supabase?.createClient) {
      throw new Error("Supabase browser client is not loaded");
    }
    return window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  }

  window.CalligraphyCloud = { createCloudStore, createSupabaseClient, canRole };
})();

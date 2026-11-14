package handler

import (
	"errors"
	"net/http"
	"strconv"

	localproject "infinite-canvas/backend/internal/project"

	"github.com/gin-gonic/gin"
)

func RegisterSmartFilmBatchRoutes(r *gin.RouterGroup, owners workspaceOwners, projects *localproject.Service) {
	r.POST("/smart-film-batches", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		var req localproject.CreateSmartFilmBatchRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		batch, err := projects.CreateSmartFilmBatch(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"batch": batch})
	})

	r.GET("/smart-film-batches/:id", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		batch, err := projects.SmartFilmBatch(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"batch": batch})
	})

	r.GET("/smart-film-batches", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
		result, err := projects.ListSmartFilmBatches(user.ID, c.Query("status"), page, pageSize)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.DELETE("/smart-film-batches/:id", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		if err := projects.DeleteSmartFilmBatchDraft(user.ID, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"deleted": true})
	})

	r.PATCH("/smart-film-batches/:id/budget", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req localproject.UpdateSmartFilmBatchBudgetRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		batch, err := projects.UpdateSmartFilmBatchBudget(user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"batch": batch})
	})

	r.GET("/smart-film-batches/:id/costs", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		costs, err := projects.SmartFilmBatchCost(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, costs)
	})

	r.PUT("/smart-film-batches/:id/scripts", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512<<10)
		var req localproject.SaveSmartFilmBatchScriptsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		batch, err := projects.SaveSmartFilmBatchScripts(user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"batch": batch})
	})

	r.PATCH("/smart-film-batches/:id/scripts/:scriptId", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 128<<10)
		var req localproject.UpdateSmartFilmBatchScriptRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		batch, err := projects.UpdateSmartFilmBatchScript(user.ID, c.Param("id"), c.Param("scriptId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"batch": batch})
	})

	r.DELETE("/smart-film-batches/:id/scripts/:scriptId", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		expectedRevision, err := strconv.ParseInt(c.Query("expectedRevision"), 10, 64)
		if err != nil || expectedRevision <= 0 {
			fail(c, http.StatusBadRequest, errors.New("expectedRevision must be a positive integer"))
			return
		}
		batch, err := projects.DeleteSmartFilmBatchScript(user.ID, c.Param("id"), c.Param("scriptId"), expectedRevision)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"batch": batch})
	})

	r.POST("/smart-film-batches/:id/confirm", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		var req localproject.ConfirmSmartFilmBatchScriptsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		batch, err := projects.ConfirmSmartFilmBatchScripts(user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"batch": batch})
	})

	r.PATCH("/smart-film-batches/:id/production-runs/:runId", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req localproject.SmartFilmProductionStageCheckpointRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		run, err := projects.CheckpointSmartFilmProductionRun(user.ID, c.Param("id"), c.Param("runId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"run": run})
	})

	r.POST("/smart-film-batches/:id/production-runs/:runId/start", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req localproject.StartSmartFilmProductionStageRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		run, err := projects.StartSmartFilmProductionStage(user.ID, c.Param("id"), c.Param("runId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"run": run})
	})

	r.PATCH("/smart-film-batches/:id/control", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req localproject.SmartFilmBatchControlRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		batch, err := projects.ControlSmartFilmBatch(user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"batch": batch})
	})

	r.PATCH("/smart-film-batches/:id/production-runs/:runId/control", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req localproject.SmartFilmProductionRunControlRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		run, err := projects.ControlSmartFilmProductionRun(user.ID, c.Param("id"), c.Param("runId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"run": run})
	})
}
